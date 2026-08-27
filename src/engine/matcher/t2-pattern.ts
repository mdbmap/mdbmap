import type { InstalmentLocator } from "@/db/schema";

import type { TierLink } from "./framework.ts";
import type { Tier, TierContext, TierProposal } from "./ladder.ts";
import type { MatchingOrder, StreamIndex } from "./monotonic.ts";
import { checkMonotonic } from "./monotonic.ts";
import { normaliseTitle } from "./tier3-scoring.ts";

// One regular instalment as T2 evidence. A whole-title transform proposes the
// pairing; the air date (or, where dates are missing, the title) is what a
// proposal is then accepted against. The specials section never reaches T2 —
// ADR-0002 leaves it to T3 — so a side's segments here already exclude it.
interface T2Instalment {
	readonly airDate: string | undefined;
	readonly locator: InstalmentLocator;
	readonly title: string | undefined;
}

// A service's regular segment (season, cour, ...). `instalments` is ordered by
// position, and a side's `segments` must already be ordered by `number`.
interface T2Segment {
	readonly instalments: readonly T2Instalment[];
	readonly number: number;
}

interface T2Side {
	readonly segments: readonly T2Segment[];
}

// A TMDB episode group as a candidate alternate ordering of the left side: the
// same instalments re-segmented under an official/DVD/absolute order. Its
// `instalmentCount` comes free with the listing, so an obviously wrong count is
// filtered before a detail request is ever spent on it.
interface EpisodeGroupSummary {
	readonly id: string;
	readonly instalmentCount: number;
}

interface EpisodeGroupOrdering {
	readonly segments: readonly T2Segment[];
}

// The budgeted accessor over a service's episode groups. `list` is the one
// listing request; `fetchDetail` is a per-group detail request. Both are spent
// against the ladder's shared budget, and only when the free arithmetic
// transforms don't already fit.
interface EpisodeGroupProvider {
	readonly detailCost: number;
	readonly fetchDetail: (id: string) => EpisodeGroupOrdering;
	readonly list: () => readonly EpisodeGroupSummary[];
	readonly listCost: number;
}

interface T2Input {
	readonly episodeGroups?: EpisodeGroupProvider;
	readonly left: T2Side;
	readonly right: T2Side;
}

// A transform's proposed 1:1 links, kept alongside the instalments they came
// from so acceptance can read each side's evidence before the pairing is
// reduced to bare locators.
interface PairedInstalments {
	readonly left: T2Instalment;
	readonly right: T2Instalment;
}

// At most three group-detail requests may follow the single listing (ADR-0002).
const MAX_EPISODE_GROUP_DETAILS = 3;

// A transform proposes; acceptance corroborates. A whole-title fit with no
// comparable pair at all is an arithmetic coincidence, not evidence, so at
// least one pair must positively agree before anything is accepted.
const MIN_COMPARABLE_PAIRS = 1;

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

type Evidence = "absent" | "agree" | "disagree";

// Agreement is within a day, not exact string equality (timezone and simulcast
// skew). A missing or unparseable date on either side is absent evidence, never
// a disagreement — this matches T3's `dayDistance`; T1 instead passes an
// unparseable date as agreement.
const compareByDate = (
	left: string | undefined,
	right: string | undefined,
): Evidence => {
	if (left === undefined || right === undefined) {
		return "absent";
	}
	const leftTime = Date.parse(left);
	const rightTime = Date.parse(right);
	if (Number.isNaN(leftTime) || Number.isNaN(rightTime)) {
		return "absent";
	}
	return Math.abs(leftTime - rightTime) <= ONE_DAY_MS ? "agree" : "disagree";
};

const compareByTitle = (
	left: string | undefined,
	right: string | undefined,
): Evidence => {
	if (left === undefined || right === undefined) {
		return "absent";
	}
	const leftTitle = normaliseTitle(left);
	const rightTitle = normaliseTitle(right);
	if (leftTitle.length === 0 || rightTitle.length === 0) {
		return "absent";
	}
	return leftTitle === rightTitle ? "agree" : "disagree";
};

// Air date first; where a pair's dates are missing, its titles decide. A pair
// with neither is absent evidence — it neither corroborates nor breaks the fit.
const pairEvidence = (pair: PairedInstalments): Evidence => {
	const byDate = compareByDate(pair.left.airDate, pair.right.airDate);
	if (byDate !== "absent") {
		return byDate;
	}
	return compareByTitle(pair.left.title, pair.right.title);
};

// A proposal is accepted only when every pair agrees (no disagreement anywhere)
// and enough pairs carry comparable evidence to corroborate the whole-title fit.
const accepted = (pairs: readonly PairedInstalments[]): boolean => {
	let comparable = 0;
	for (const pair of pairs) {
		const evidence = pairEvidence(pair);
		if (evidence === "disagree") {
			return false;
		}
		if (evidence === "agree") {
			comparable += 1;
		}
	}
	return comparable >= MIN_COMPARABLE_PAIRS;
};

const flatten = (side: T2Side): readonly T2Instalment[] =>
	side.segments.flatMap((segment) => segment.instalments);

// Pair two equal-length instalment runs 1:1 by position. Unequal totals mean the
// transform does not cover the whole title — a partial fit, which ADR-0002
// leaves as an unmatched group rather than a best-effort guess.
const zipByPosition = (
	left: readonly T2Instalment[],
	right: readonly T2Instalment[],
): readonly PairedInstalments[] | undefined => {
	if (left.length === 0 || left.length !== right.length) {
		return undefined;
	}
	const pairs: PairedInstalments[] = [];
	for (const [index, leftInstalment] of left.entries()) {
		const rightInstalment = right[index];
		if (rightInstalment === undefined) {
			return undefined;
		}
		pairs.push({ left: leftInstalment, right: rightInstalment });
	}
	return pairs;
};

// Continuous↔segmented renumbering: ignore both sides' segment boundaries and
// pair by cumulative position across the whole title. A continuous run and a
// segmented one with the same instalment total line up here whichever side is
// segmented, which is the transform in both directions.
const renumber = (
	left: T2Side,
	right: T2Side,
): readonly PairedInstalments[] | undefined =>
	zipByPosition(flatten(left), flatten(right));

// Constant segment offset: the same segment structure, its numbers shifted by a
// constant (a continuation catalogued as seasons 4–6 against 1–3). Segments must
// correspond in count and per-segment size under one offset; a zero offset is
// plain structural agreement, which is T1's job, not a transform.
const constantOffset = (
	left: T2Side,
	right: T2Side,
): readonly PairedInstalments[] | undefined => {
	const [firstLeft] = left.segments;
	const [firstRight] = right.segments;
	if (
		firstLeft === undefined ||
		firstRight === undefined ||
		left.segments.length !== right.segments.length
	) {
		return undefined;
	}
	const offset = firstRight.number - firstLeft.number;
	if (offset === 0) {
		return undefined;
	}
	const pairs: PairedInstalments[] = [];
	for (const [index, leftSegment] of left.segments.entries()) {
		const rightSegment = right.segments[index];
		if (
			rightSegment === undefined ||
			rightSegment.number !== leftSegment.number + offset ||
			rightSegment.instalments.length !== leftSegment.instalments.length
		) {
			return undefined;
		}
		const segmentPairs = zipByPosition(
			leftSegment.instalments,
			rightSegment.instalments,
		);
		if (segmentPairs === undefined) {
			return undefined;
		}
		pairs.push(...segmentPairs);
	}
	return pairs;
};

// The free arithmetic transforms, tried structural-first: a segment-offset fit
// is a stronger structural claim than a bare total-count match, so it is
// preferred when both would apply. The first transform whose proposal clears
// acceptance wins; a transform that applies but fails acceptance falls through.
const freeTransforms = (
	left: T2Side,
	right: T2Side,
): readonly PairedInstalments[] | undefined => {
	for (const transform of [constantOffset, renumber]) {
		const pairs = transform(left, right);
		if (pairs !== undefined && accepted(pairs)) {
			return pairs;
		}
	}
	return undefined;
};

const toTierLinks = (
	pairs: readonly PairedInstalments[],
): readonly TierLink[] =>
	pairs.map((pair) => ({
		confidence: "high",
		left: [pair.left.locator],
		right: [pair.right.locator],
	}));

const holdsUnder = (
	order: MatchingOrder,
	pairs: readonly PairedInstalments[],
): boolean => checkMonotonic(toTierLinks(pairs), order.left, order.right).ok;

const indexEpisodeGroup = (
	context: TierContext,
	ordering: EpisodeGroupOrdering,
): StreamIndex => {
	const position = new Map<InstalmentLocator, number>();
	for (const instalment of flatten({ segments: ordering.segments })) {
		if (
			context.order.left.position.has(instalment.locator) &&
			!position.has(instalment.locator)
		) {
			position.set(instalment.locator, position.size);
		}
	}
	for (const instalment of context.left.instalments) {
		if (!position.has(instalment.locator)) {
			position.set(instalment.locator, position.size);
		}
	}
	return { position, regular: context.order.left.regular };
};

interface EpisodeGroupMatch {
	readonly order: MatchingOrder;
	readonly pairs: readonly PairedInstalments[];
}

// Episode groups are the paid fallback: one listing, then at most three
// group-detail requests, each an alternate ordering re-run through the free
// transforms. Groups whose instalment count can't cover the right side are
// filtered before any detail request is spent on them.
const tryEpisodeGroups = (
	context: TierContext,
	input: T2Input,
): EpisodeGroupMatch | undefined => {
	const provider = input.episodeGroups;
	if (provider === undefined || !context.budget.spend(provider.listCost)) {
		return undefined;
	}
	const rightCount = flatten(input.right).length;
	const candidates = provider
		.list()
		.filter((summary) => summary.instalmentCount === rightCount);
	let detailsUsed = 0;
	for (const summary of candidates) {
		if (
			detailsUsed >= MAX_EPISODE_GROUP_DETAILS ||
			!context.budget.spend(provider.detailCost)
		) {
			break;
		}
		detailsUsed += 1;
		const ordering = provider.fetchDetail(summary.id);
		const pairs = freeTransforms({ segments: ordering.segments }, input.right);
		const order = {
			left: indexEpisodeGroup(context, ordering),
			right: context.order.right,
		};
		if (pairs !== undefined && holdsUnder(order, pairs)) {
			return { order, pairs };
		}
	}
	return undefined;
};

// Tier 2 — pattern (ADR-0002). Runs on what T1 leaves: when T1 placed a full
// structural alignment there is nothing whole-title left to transform, so T2
// stands down. Otherwise it tries the free arithmetic transforms and, only when
// none fit, spends the episode-group budget. Free or paid, a proposal is
// accepted whole or not at all — a partial fit stays an unmatched group.
const createT2PatternTier = (input: T2Input): Tier => ({
	id: "t2-pattern",
	propose: (context: TierContext): TierProposal => {
		if (context.placed.length > 0) {
			return { kind: "proposed", links: [] };
		}
		const free = freeTransforms(input.left, input.right);
		if (free !== undefined) {
			return { kind: "proposed", links: toTierLinks(free) };
		}
		const episodeGroup = tryEpisodeGroups(context, input);
		if (episodeGroup === undefined) {
			// An unavailable listing is absent evidence, not a refused ladder.
			return { kind: "proposed", links: [] };
		}
		return {
			kind: "proposed",
			links: toTierLinks(episodeGroup.pairs),
			order: episodeGroup.order,
		};
	},
});

export { createT2PatternTier };
export type {
	EpisodeGroupOrdering,
	EpisodeGroupProvider,
	EpisodeGroupSummary,
	T2Input,
	T2Instalment,
	T2Segment,
	T2Side,
};
