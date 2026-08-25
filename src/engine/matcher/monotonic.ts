import type { InstalmentLocator } from "@/db/schema";

import type { InstalmentStream } from "./instalment.ts";

type NonEmptyArray<Element> = readonly [Element, ...(readonly Element[])];

// One tier proposal: the left instalments and right instalments that cover a
// shared content unit. A regular 1:1 link is `[a]`/`[b]`; a merge is several on
// one side, a split several on the other.
interface CandidatePairing {
	readonly left: NonEmptyArray<InstalmentLocator>;
	readonly right: NonEmptyArray<InstalmentLocator>;
}

interface StreamIndex {
	readonly position: ReadonlyMap<InstalmentLocator, number>;
	readonly regular: ReadonlySet<InstalmentLocator>;
}

const indexStream = (stream: InstalmentStream): StreamIndex => {
	const position = new Map<InstalmentLocator, number>();
	const regular = new Set<InstalmentLocator>();
	let order = 0;
	for (const instalment of stream.instalments) {
		position.set(instalment.locator, order);
		if (instalment.kind === "regular") {
			regular.add(instalment.locator);
		}
		order += 1;
	}
	return { position, regular };
};

interface Span {
	readonly max: number;
	readonly min: number;
}

// A side's span is measured over its regular locators alone. Specials carry an
// off-ordinal storage index that would poison the span, so a side made only of
// specials yields no span and imposes no constraint on that side's sweep.
const spanOf = (
	locators: NonEmptyArray<InstalmentLocator>,
	index: StreamIndex,
	side: "left" | "right",
): Span | undefined => {
	const positions = locators
		.filter((locator) => index.regular.has(locator))
		.map((locator) => {
			const position = index.position.get(locator);
			if (position === undefined) {
				throw new Error(
					`matcher: ${side} locator ${locator} is not in its stream`,
				);
			}
			return position;
		});
	if (positions.length === 0) {
		return undefined;
	}
	return { max: Math.max(...positions), min: Math.min(...positions) };
};

// A pairing is exempt from the crossing sweep only when it carries no
// main-sequence position at all — every locator on both sides is a special. A
// pairing that mixes a special with a regular still pins that regular to a
// main-sequence position, so it must be checked or the regular could map twice.
const touchesMainSequence = (
	pairing: CandidatePairing,
	leftIndex: StreamIndex,
	rightIndex: StreamIndex,
): boolean =>
	pairing.left.some((locator) => leftIndex.regular.has(locator)) ||
	pairing.right.some((locator) => rightIndex.regular.has(locator));

interface Crossing {
	readonly earlier: CandidatePairing;
	readonly later: CandidatePairing;
	readonly side: "left" | "right";
}

type MonotonicVerdict =
	| { readonly crossings: readonly Crossing[]; readonly ok: false }
	| { readonly ok: true };

interface Reach {
	readonly max: number;
	readonly pairing: CandidatePairing;
}

const startKey = (span: Span | undefined): number =>
	span?.min ?? Number.POSITIVE_INFINITY;

interface RankedPairing {
	readonly left: Span | undefined;
	readonly pairing: CandidatePairing;
	readonly right: Span | undefined;
}

// Sweep one side of a pairing: an empty span (all specials) is inert, otherwise
// a start at or before the furthest end seen so far is a crossing. Returns the
// extended reach for the next pairing.
const sweepSide = (
	entry: RankedPairing,
	side: "left" | "right",
	reach: Reach | undefined,
	crossings: Crossing[],
): Reach | undefined => {
	const span = entry[side];
	if (span === undefined) {
		return reach;
	}
	if (reach !== undefined && span.min <= reach.max) {
		crossings.push({ earlier: reach.pairing, later: entry.pairing, side });
	}
	return reach === undefined || span.max > reach.max
		? { max: span.max, pairing: entry.pairing }
		: reach;
};

// Legal alignments preserve both sequences' relative order: gaps and split or
// merged runs are fine, but two pairings may never overlap or cross. Sorting by
// left start, every later pairing must also start after the furthest right end
// seen so far; anything else is a crossing and the whole set stays unpublished.
const checkMonotonic = (
	pairings: readonly CandidatePairing[],
	leftIndex: StreamIndex,
	rightIndex: StreamIndex,
): MonotonicVerdict => {
	const ranked = pairings
		.filter((pairing) => touchesMainSequence(pairing, leftIndex, rightIndex))
		.map((pairing) => ({
			left: spanOf(pairing.left, leftIndex, "left"),
			pairing,
			right: spanOf(pairing.right, rightIndex, "right"),
		}))
		.toSorted((first, second) => startKey(first.left) - startKey(second.left));

	const crossings: Crossing[] = [];
	let leftReach: Reach | undefined;
	let rightReach: Reach | undefined;
	for (const entry of ranked) {
		leftReach = sweepSide(entry, "left", leftReach, crossings);
		rightReach = sweepSide(entry, "right", rightReach, crossings);
	}
	return crossings.length > 0 ? { crossings, ok: false } : { ok: true };
};

export { checkMonotonic, indexStream };
export type {
	CandidatePairing,
	Crossing,
	MonotonicVerdict,
	NonEmptyArray,
	StreamIndex,
};
