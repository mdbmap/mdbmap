import type { AssertionConfidence } from "@/db/columns";
import type { InstalmentLocator } from "@/db/schema";

import type { InstalmentStream } from "./instalment.ts";
import type {
	CandidatePairing,
	Crossing,
	MatchingOrder,
	NonEmptyArray,
	StreamIndex,
} from "./monotonic.ts";
import { checkMonotonic, indexStream } from "./monotonic.ts";

interface AlignedPair {
	readonly confidence: AssertionConfidence;
	readonly left: readonly InstalmentLocator[];
	readonly right: readonly InstalmentLocator[];
}

interface TierLink {
	readonly confidence: AssertionConfidence;
	readonly left: NonEmptyArray<InstalmentLocator>;
	readonly right: NonEmptyArray<InstalmentLocator>;
}

interface AlignInput {
	readonly left: InstalmentStream;
	readonly links: readonly TierLink[];
	readonly order?: MatchingOrder;
	readonly right: InstalmentStream;
}

// A tier-supplied locator that names no instalment in the stream it was proposed
// against. Any pairing carrying one is rejected before assembly.
interface StrayLocator {
	readonly locator: InstalmentLocator;
	readonly side: "left" | "right";
}

// A locator that more than one pairing claims on the same side. All legal
// multi-coverage lives within a single pairing, so a shared locator has no legal
// reading whatever its kind, and the set is rejected before assembly.
interface ReusedLocator {
	readonly locator: InstalmentLocator;
	readonly side: "left" | "right";
}

// `noCounterpart` is an explicit `[]` for an evaluated released instalment;
// `pending` is an airing stream's future position beyond its settled prefix,
// which never hardens into no-counterpart.
interface SideDisposition {
	readonly noCounterpart: readonly InstalmentLocator[];
	readonly pending: readonly InstalmentLocator[];
}

interface PublishedAlignment {
	readonly left: SideDisposition;
	readonly pairs: readonly AlignedPair[];
	readonly right: SideDisposition;
}

type AlignmentOutcome =
	| { readonly alignment: PublishedAlignment; readonly status: "published" }
	| { readonly crossings: readonly Crossing[]; readonly status: "conflict" }
	| { readonly reason: "over-budget"; readonly status: "unmatched" }
	| { readonly reason: "truncated-fetch"; readonly status: "unpublishable" }
	| {
			readonly reused: readonly ReusedLocator[];
			readonly status: "invalid";
			readonly strays: readonly StrayLocator[];
	  };

// Locators absent from their stream never reach the crossing check: the specials
// exemption filters them out first, so membership must be enforced here, on every
// pairing, before anything publishes.
const findStrays = (
	pairings: readonly CandidatePairing[],
	leftIndex: StreamIndex,
	rightIndex: StreamIndex,
): readonly StrayLocator[] => {
	const strays: StrayLocator[] = [];
	for (const pairing of pairings) {
		for (const locator of pairing.left) {
			if (!leftIndex.position.has(locator)) {
				strays.push({ locator, side: "left" });
			}
		}
		for (const locator of pairing.right) {
			if (!rightIndex.position.has(locator)) {
				strays.push({ locator, side: "right" });
			}
		}
	}
	return strays;
};

// A locator may be claimed by at most one pairing on its side. Two pairings
// sharing one has no legal reading — merges and splits are expressed within a
// single pairing — so it never reaches the crossing sweep, which is where an
// all-special reuse would otherwise slip through as an inert (spanless) side.
const findReused = (
	pairings: readonly CandidatePairing[],
): readonly ReusedLocator[] => {
	const reused: ReusedLocator[] = [];
	for (const side of ["left", "right"] as const) {
		const claims = new Map<InstalmentLocator, number>();
		for (const pairing of pairings) {
			for (const locator of new Set(pairing[side])) {
				const seen = (claims.get(locator) ?? 0) + 1;
				claims.set(locator, seen);
				if (seen === 2) {
					reused.push({ locator, side });
				}
			}
		}
	}
	return reused;
};

// An airing stream's settled prefix ends at its last paired position: unpaired
// instalments at or before it are released and evaluated (`noCounterpart`), while
// only positions beyond it are unarrived and stay `pending`. A complete stream
// has no future tail, so every unpaired instalment is a no-counterpart.
const disposeSide = (
	stream: InstalmentStream,
	paired: ReadonlySet<InstalmentLocator>,
): SideDisposition => {
	const noCounterpart: InstalmentLocator[] = [];
	const pending: InstalmentLocator[] = [];
	let lastPaired = -1;
	for (const [index, instalment] of stream.instalments.entries()) {
		if (paired.has(instalment.locator)) {
			lastPaired = index;
		}
	}
	for (const [index, instalment] of stream.instalments.entries()) {
		if (paired.has(instalment.locator)) {
			continue;
		}
		if (stream.boundary === "airing" && index > lastPaired) {
			pending.push(instalment.locator);
		} else {
			noCounterpart.push(instalment.locator);
		}
	}
	return { noCounterpart, pending };
};

// Validate the tier-supplied pairings against both streams and assemble the
// published alignment. A truncated fetch cannot publish at all; a crossing set
// stays a conflict outside the graph; otherwise every unpaired instalment is
// dispositioned by its own stream's boundary.
const alignStreams = (input: AlignInput): AlignmentOutcome => {
	const { left, links, order, right } = input;
	if (left.boundary === "truncated" || right.boundary === "truncated") {
		return { reason: "truncated-fetch", status: "unpublishable" };
	}
	const leftIndex = order?.left ?? indexStream(left);
	const rightIndex = order?.right ?? indexStream(right);
	const strays = findStrays(links, leftIndex, rightIndex);
	const reused = findReused(links);
	if (strays.length > 0 || reused.length > 0) {
		return { reused, status: "invalid", strays };
	}
	const verdict = checkMonotonic(links, leftIndex, rightIndex);
	if (!verdict.ok) {
		return { crossings: verdict.crossings, status: "conflict" };
	}
	const leftPaired = new Set<InstalmentLocator>();
	const rightPaired = new Set<InstalmentLocator>();
	const pairs: AlignedPair[] = links.map((link) => {
		for (const locator of link.left) {
			leftPaired.add(locator);
		}
		for (const locator of link.right) {
			rightPaired.add(locator);
		}
		return {
			confidence: link.confidence,
			left: link.left,
			right: link.right,
		};
	});
	return {
		alignment: {
			left: disposeSide(left, leftPaired),
			pairs,
			right: disposeSide(right, rightPaired),
		},
		status: "published",
	};
};

export { alignStreams };
export type {
	AlignedPair,
	AlignInput,
	AlignmentOutcome,
	PublishedAlignment,
	ReusedLocator,
	SideDisposition,
	StrayLocator,
	TierLink,
};
