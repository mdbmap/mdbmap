import type { AssertionConfidence } from "@/db/columns";
import type { InstalmentLocator } from "@/db/schema";

import type { InstalmentKind, InstalmentStream } from "./instalment.ts";
import type { Tier } from "./ladder.ts";
import type {
	CandidatePairing,
	NonEmptyArray,
	StreamIndex,
} from "./monotonic.ts";
import { checkMonotonic, indexStream } from "./monotonic.ts";
import { dayDistance, normaliseTitle, titleSimilarity } from "./tier3-scoring.ts";

// Per-instalment metadata the tier scores on, keyed by locator. Everything is
// optional: absence is absent evidence, never a mismatch.
interface InstalmentFacts {
	readonly airDate?: string;
	readonly runtime?: number;
	readonly title?: string;
}

type FactsByLocator = ReadonlyMap<InstalmentLocator, InstalmentFacts>;

// A high link auto-accepts; a mid-band link publishes `low` and raises a review
// flag; below the mid band nothing links and the instalment stays an unlinked
// spoke.
interface Tier3Link {
	readonly confidence: AssertionConfidence;
	readonly flagged: boolean;
	readonly pairing: CandidatePairing;
	readonly score: number;
}

// A side's untaken pool split by its stream boundary: `unlinked*` are the final
// no-counterpart spokes; `pending*` are positions T3 must not settle — an airing
// stream's unaired tail, anything in a truncated fetch, or a member whose
// above-band counterpart was dropped only for crossing — none of which can
// harden into a known-no-counterpart.
interface Tier3Result {
	readonly links: readonly Tier3Link[];
	readonly pendingLeft: readonly InstalmentLocator[];
	readonly pendingRight: readonly InstalmentLocator[];
	readonly unlinkedLeft: readonly InstalmentLocator[];
	readonly unlinkedRight: readonly InstalmentLocator[];
}

interface Disposition {
	readonly pending: readonly InstalmentLocator[];
	readonly unlinked: readonly InstalmentLocator[];
}

interface Tier3Input {
	readonly facts: FactsByLocator;
	readonly left: InstalmentStream;
	readonly placed?: readonly CandidatePairing[];
	readonly right: InstalmentStream;
}

// Air date within tolerance is a strong identifying signal; a wider gap is a
// hard disqualification, not merely weak evidence.
const DATE_TOLERANCE_DAYS = 1;
const DATE_BASE = 0.9;
const DATE_DECAY = 0.12;

// A high link auto-accepts, a mid-band link publishes `low`, and anything below
// the mid band never links.
const HIGH_BAND = 0.8;
const MID_BAND = 0.5;

// Runtime and position only ever support: they add to a comparable score and
// never subtract, so structure is never assumed on their own.
const RUNTIME_BONUS_MAX = 0.15;
const RUNTIME_FLOOR = 0.8;
const POSITION_BONUS_MAX = 0.05;

// One member of a candidate unit, carrying its stream position and the facts the
// scorer reads.
interface Member {
	readonly airDate: string | undefined;
	readonly index: number;
	readonly kind: InstalmentKind;
	readonly locator: InstalmentLocator;
	readonly runtime: number | undefined;
	readonly title: string | undefined;
}

// A scoring unit: a single instalment, or a run of consecutive same-day
// instalments competing as one so summed runtimes can resolve a split or merge.
interface Unit {
	readonly airDate: string | undefined;
	readonly hasSpecial: boolean;
	readonly locators: NonEmptyArray<InstalmentLocator>;
	readonly position: number;
	readonly runtime: number | undefined;
	readonly title: string;
}

interface Candidate {
	readonly left: Unit;
	readonly right: Unit;
	readonly score: number;
}

const toNonEmpty = (
	locators: readonly InstalmentLocator[],
): NonEmptyArray<InstalmentLocator> => {
	const [head, ...tail] = locators;
	if (head === undefined) {
		throw new Error("tier3: cannot build a unit from zero members");
	}
	return [head, ...tail];
};

const membersOf = (
	stream: InstalmentStream,
	facts: FactsByLocator,
): readonly Member[] =>
	stream.instalments.map((instalment, index) => {
		const fact = facts.get(instalment.locator);
		return {
			airDate: fact?.airDate,
			index,
			kind: instalment.kind,
			locator: instalment.locator,
			runtime: fact?.runtime,
			title: fact?.title,
		};
	});

const makeUnit = (members: NonEmptyArray<Member>, length: number): Unit => {
	const [first] = members;
	const sharedDate = members.every(
		(member) => member.airDate !== undefined && member.airDate === first.airDate,
	);
	const timed = members.every(
		(member) => member.runtime !== undefined && member.runtime > 0,
	);
	const denominator = Math.max(1, length - 1);
	return {
		airDate: sharedDate ? first.airDate : undefined,
		hasSpecial: members.some((member) => member.kind === "special"),
		locators: toNonEmpty(members.map((member) => member.locator)),
		position:
			members.reduce((sum, member) => sum + member.index / denominator, 0) /
			members.length,
		runtime: timed
			? members.reduce((sum, member) => sum + (member.runtime ?? 0), 0)
			: undefined,
		title: normaliseTitle(members.map((member) => member.title ?? "").join(" ")),
	};
};

// Every unpaired member becomes a single unit; each maximal run of consecutive
// same-day members also competes as one combined unit.
const buildUnits = (
	stream: InstalmentStream,
	facts: FactsByLocator,
	consumed: ReadonlySet<InstalmentLocator>,
): readonly Unit[] => {
	const members = membersOf(stream, facts);
	const { length } = members;
	const units: Unit[] = [];
	let run: Member[] = [];
	const flushRun = (): void => {
		const [head, ...tail] = run;
		if (head !== undefined && tail.length > 0) {
			units.push(makeUnit([head, ...tail], length));
		}
		run = [];
	};
	for (const member of members) {
		if (consumed.has(member.locator)) {
			flushRun();
			continue;
		}
		units.push(makeUnit([member], length));
		if (member.airDate === undefined) {
			flushRun();
			continue;
		}
		const last = run.at(-1);
		if (last !== undefined && last.airDate !== member.airDate) {
			flushRun();
		}
		run.push(member);
	}
	flushRun();
	return units;
};

const runtimeBonus = (left: Unit, right: Unit): number => {
	if (left.runtime === undefined || right.runtime === undefined) {
		return 0;
	}
	const ratio =
		Math.min(left.runtime, right.runtime) / Math.max(left.runtime, right.runtime);
	if (ratio <= RUNTIME_FLOOR) {
		return 0;
	}
	return ((ratio - RUNTIME_FLOOR) / (1 - RUNTIME_FLOOR)) * RUNTIME_BONUS_MAX;
};

// Position only supports a match between two purely regular units, and never
// where a special is involved — a special's slot carries no scoring weight.
const positionBonus = (left: Unit, right: Unit): number => {
	if (left.hasSpecial || right.hasSpecial) {
		return 0;
	}
	return Math.max(0, 1 - Math.abs(left.position - right.position)) *
		POSITION_BONUS_MAX;
};

// Score a candidate, or reject it. At least one identifying signal (air date or
// title) must be comparable; a date gap past tolerance disqualifies outright.
const scoreUnits = (left: Unit, right: Unit): number | undefined => {
	const identifying: number[] = [];
	if (left.airDate !== undefined && right.airDate !== undefined) {
		const distance = dayDistance(left.airDate, right.airDate);
		if (distance !== undefined) {
			if (distance > DATE_TOLERANCE_DAYS) {
				return undefined;
			}
			identifying.push(DATE_BASE - distance * DATE_DECAY);
		}
	}
	if (left.title.length > 0 && right.title.length > 0) {
		identifying.push(titleSimilarity(left.title, right.title));
	}
	if (identifying.length === 0) {
		return undefined;
	}
	const base =
		identifying.reduce((sum, value) => sum + value, 0) / identifying.length;
	return base + runtimeBonus(left, right) + positionBonus(left, right);
};

const consumedLocators = (
	placed: readonly CandidatePairing[],
	side: "left" | "right",
): ReadonlySet<InstalmentLocator> => {
	const consumed = new Set<InstalmentLocator>();
	for (const pairing of placed) {
		for (const locator of pairing[side]) {
			consumed.add(locator);
		}
	}
	return consumed;
};

const rankCandidates = (
	leftUnits: readonly Unit[],
	rightUnits: readonly Unit[],
): readonly Candidate[] => {
	const candidates: Candidate[] = [];
	for (const left of leftUnits) {
		for (const right of rightUnits) {
			const score = scoreUnits(left, right);
			if (score !== undefined) {
				candidates.push({ left, right, score });
			}
		}
	}
	return candidates.toSorted((first, second) => second.score - first.score);
};

// Score every candidate, greedily link the best-scoring disjoint pairs, and
// report whatever the greedy pass left unlinked as explicit no-counterpart
// spokes.
interface GreedyResult {
	readonly conflictedLeft: ReadonlySet<InstalmentLocator>;
	readonly conflictedRight: ReadonlySet<InstalmentLocator>;
	readonly links: readonly Tier3Link[];
	readonly takenLeft: ReadonlySet<InstalmentLocator>;
	readonly takenRight: ReadonlySet<InstalmentLocator>;
}

interface GreedyInput {
	readonly base: readonly CandidatePairing[];
	readonly candidates: readonly Candidate[];
	readonly leftIndex: StreamIndex;
	readonly rightIndex: StreamIndex;
}

// Walk the ranked candidates once, linking a pair only when neither side is
// already claimed and it stays monotonic against everything placed so far —
// earlier rungs included. A crossing pick is dropped rather than allowed to
// downgrade the whole accumulated alignment to a conflict. Candidates below the
// mid band never link, so the sorted order lets the scan stop at the first one.
const addAll = (
	set: Set<InstalmentLocator>,
	locators: readonly InstalmentLocator[],
): void => {
	for (const locator of locators) {
		set.add(locator);
	}
};

const greedyLink = (input: GreedyInput): GreedyResult => {
	const takenLeft = new Set<InstalmentLocator>();
	const takenRight = new Set<InstalmentLocator>();
	const conflictedLeft = new Set<InstalmentLocator>();
	const conflictedRight = new Set<InstalmentLocator>();
	const accepted: CandidatePairing[] = [];
	const links: Tier3Link[] = [];
	for (const candidate of input.candidates) {
		if (candidate.score < MID_BAND) {
			break;
		}
		const pairing: CandidatePairing = {
			left: candidate.left.locators,
			right: candidate.right.locators,
		};
		const clashes =
			candidate.left.locators.some((locator) => takenLeft.has(locator)) ||
			candidate.right.locators.some((locator) => takenRight.has(locator));
		if (clashes) {
			continue;
		}
		const monotonic = checkMonotonic(
			[...input.base, ...accepted, pairing],
			input.leftIndex,
			input.rightIndex,
		);
		if (!monotonic.ok) {
			// Rejected for crossing, not for lack of a counterpart: both sides stay
			// untaken, so record them as conflicted rather than letting them harden
			// into final no-counterpart spokes.
			addAll(conflictedLeft, candidate.left.locators);
			addAll(conflictedRight, candidate.right.locators);
			continue;
		}
		addAll(takenLeft, candidate.left.locators);
		addAll(takenRight, candidate.right.locators);
		accepted.push(pairing);
		const high = candidate.score >= HIGH_BAND;
		links.push({
			confidence: high ? "high" : "low",
			flagged: !high,
			pairing,
			score: candidate.score,
		});
	}
	return { conflictedLeft, conflictedRight, links, takenLeft, takenRight };
};

// Split a side's untaken pool by boundary, mirroring the framework's own
// disposition: the settled prefix ends at the last paired position, so an airing
// stream's later positions stay pending rather than settling as no-counterpart,
// and a truncated fetch settles nothing at all. A member left over from a
// crossing-rejected candidate stays pending on any boundary — it had a real
// above-band counterpart, so it is a conflict for review, never a final absence.
const disposeUnlinked = (
	stream: InstalmentStream,
	consumed: ReadonlySet<InstalmentLocator>,
	taken: ReadonlySet<InstalmentLocator>,
	conflicted: ReadonlySet<InstalmentLocator>,
): Disposition => {
	const paired = (locator: InstalmentLocator): boolean =>
		consumed.has(locator) || taken.has(locator);
	let lastPaired = -1;
	for (const [index, instalment] of stream.instalments.entries()) {
		if (paired(instalment.locator)) {
			lastPaired = index;
		}
	}
	const pending: InstalmentLocator[] = [];
	const unlinked: InstalmentLocator[] = [];
	for (const [index, instalment] of stream.instalments.entries()) {
		if (paired(instalment.locator)) {
			continue;
		}
		if (conflicted.has(instalment.locator)) {
			pending.push(instalment.locator);
			continue;
		}
		const settled =
			stream.boundary === "complete" ||
			(stream.boundary === "airing" && index <= lastPaired);
		if (settled) {
			unlinked.push(instalment.locator);
		} else {
			pending.push(instalment.locator);
		}
	}
	return { pending, unlinked };
};

const matchTier3 = (input: Tier3Input): Tier3Result => {
	const placed = input.placed ?? [];
	const consumedLeft = consumedLocators(placed, "left");
	const consumedRight = consumedLocators(placed, "right");
	const leftUnits = buildUnits(input.left, input.facts, consumedLeft);
	const rightUnits = buildUnits(input.right, input.facts, consumedRight);

	const { conflictedLeft, conflictedRight, links, takenLeft, takenRight } =
		greedyLink({
			base: placed,
			candidates: rankCandidates(leftUnits, rightUnits),
			leftIndex: indexStream(input.left),
			rightIndex: indexStream(input.right),
		});

	const left = disposeUnlinked(input.left, consumedLeft, takenLeft, conflictedLeft);
	const right = disposeUnlinked(
		input.right,
		consumedRight,
		takenRight,
		conflictedRight,
	);
	return {
		links,
		pendingLeft: left.pending,
		pendingRight: right.pending,
		unlinkedLeft: left.unlinked,
		unlinkedRight: right.unlinked,
	};
};

// Adapt the scorer to the ladder seam: T3 always runs, scores whatever earlier
// rungs left unplaced, and proposes only the pairings that cleared the mid band.
// The `Tier` seam carries pairings alone, so per-link confidence and review
// flags do not survive this path — persistence reads them from `matchTier3`
// directly, which is the authoritative T3 output; `createTier3` exists only to
// fold T3's pairings into the framework's monotonic assembly.
const createTier3 = (facts: FactsByLocator): Tier => ({
	id: "t3-episode",
	propose: (context) => ({
		pairings: matchTier3({
			facts,
			left: context.left,
			placed: context.placed,
			right: context.right,
		}).links.map((link) => link.pairing),
	}),
});

export { createTier3, matchTier3 };
export type { FactsByLocator, InstalmentFacts, Tier3Input, Tier3Link, Tier3Result };
