import type { InstalmentLocator } from "@/db/schema";

import type { Tier, TierContext, TierProposal } from "./ladder.ts";
import type { CandidatePairing } from "./monotonic.ts";

// One regular instalment as T1 evidence: its number within its segment and,
// where known, an air date for the spot check. The specials section (TMDB
// season 0, IMDb's non-numeric seasons) never reaches T1 — ADR-0002 leaves it
// to a later tier, so a side's segments here must already exclude it.
interface T1Instalment {
	readonly airDate: string | undefined;
	readonly instalmentNumber: number;
	readonly locator: InstalmentLocator;
}

// A service's regular segment (season, cour, ...). `instalments` is ordered by
// position, and a side's `segments` must already be ordered by `number`.
interface T1Segment {
	readonly instalments: readonly T1Instalment[];
	readonly number: number;
}

interface T1Side {
	readonly segments: readonly T1Segment[];
}

interface T1Input {
	// The fetch cost already spent enumerating both sides' regular segments
	// (TMDB season requests, IMDb pages), charged against the ladder's shared
	// budget before T1 will trust the evidence enough to compare it.
	readonly cost: number;
	readonly left: T1Side;
	readonly right: T1Side;
}

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

// Two dates agree within a day. Services date a title from different events
// (timezone, simulcast) and ADR-0002 treats date agreement tolerantly (T3
// scores with ±1-day proximity), so an exact-string gate would systematically
// fail structurally identical titles. An unparseable date is absent evidence.
const datesAgree = (left: string, right: string): boolean => {
	const leftTime = Date.parse(left);
	const rightTime = Date.parse(right);
	return (
		Number.isNaN(leftTime) ||
		Number.isNaN(rightTime) ||
		Math.abs(leftTime - rightTime) <= ONE_DAY_MS
	);
};

// A spot check looks at a matched segment's first and last instalment only —
// cheap corroboration on top of the free number comparison, not a full sweep.
// Missing dates on either side are absent evidence, not disagreement, so they
// never fail the check.
const spotCheckAirDatesAgree = (left: T1Segment, right: T1Segment): boolean => {
	const lastIndex = left.instalments.length - 1;
	return [0, lastIndex].every((index) => {
		const leftDate = left.instalments[index]?.airDate;
		const rightDate = right.instalments[index]?.airDate;
		return (
			leftDate === undefined ||
			rightDate === undefined ||
			datesAgree(leftDate, rightDate)
		);
	});
};

// A segment demonstrably matches only when its number, its instalment count
// and every instalment's number agree, and the air-date spot check passes.
const segmentsAgree = (left: T1Segment, right: T1Segment): boolean =>
	left.number === right.number &&
	left.instalments.length === right.instalments.length &&
	left.instalments.every((instalment, index) => {
		const counterpart = right.instalments[index];
		return counterpart !== undefined
			&& instalment.instalmentNumber === counterpart.instalmentNumber;
	}) &&
	spotCheckAirDatesAgree(left, right);

// Structure agrees only when both sides carry the same ordered segment
// numbers and every corresponding segment agrees. Anything else — a missing
// segment, an extra one, a renumbering — is T2's pattern-transform territory,
// not a guess T1 makes.
const structureAgrees = (left: T1Side, right: T1Side): boolean =>
	left.segments.length === right.segments.length &&
	left.segments.every((segment, index) => {
		const counterpart = right.segments[index];
		return counterpart !== undefined && segmentsAgree(segment, counterpart);
	});

// One candidate pairing per instalment, in segment then instalment order. Both
// sides were already proven equal in shape by `structureAgrees`, so every
// index lines up.
const buildPairings = (left: T1Side, right: T1Side): readonly CandidatePairing[] => {
	const pairings: CandidatePairing[] = [];
	for (const [segmentIndex, leftSegment] of left.segments.entries()) {
		const rightSegment = right.segments[segmentIndex];
		if (rightSegment === undefined) {
			continue;
		}
		for (const [instalmentIndex, leftInstalment] of leftSegment.instalments.entries()) {
			const rightInstalment = rightSegment.instalments[instalmentIndex];
			if (rightInstalment === undefined) {
				continue;
			}
			pairings.push({
				left: [leftInstalment.locator],
				right: [rightInstalment.locator],
			});
		}
	}
	return pairings;
};

// Tier 1 — structure (ADR-0002). Aligns a pair only when segments demonstrably
// agree; anything else proposes nothing, which the framework then persists as
// an explicit unmatched group for a later tier to upgrade. The enumeration
// cost is charged up front: a title over budget proposes nothing without ever
// comparing structure, leaving no spokes for this tier to have guessed at.
const createT1StructureTier = (input: T1Input): Tier => ({
	id: "t1-structure",
	propose: (context: TierContext): TierProposal => {
		if (!context.budget.spend(input.cost)) {
			return { pairings: [] };
		}
		if (!structureAgrees(input.left, input.right)) {
			return { pairings: [] };
		}
		return { pairings: buildPairings(input.left, input.right) };
	},
});

export { createT1StructureTier };
export type { T1Input, T1Instalment, T1Segment, T1Side };
