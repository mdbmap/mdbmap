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

type SpanOrder = "after" | "before" | "overlap";

// Two regular spans on one side sit wholly before, wholly after, or overlap.
// Overlap means the pairings interleave that side's positions, which no
// monotonic alignment can hold. Comparing only real positions keeps this
// NaN-free — no sentinel ever enters the arithmetic.
const orderSpans = (first: Span, second: Span): SpanOrder => {
	if (first.max < second.min) {
		return "before";
	}
	if (second.max < first.min) {
		return "after";
	}
	return "overlap";
};

interface AnchoredPairing {
	readonly left: Span | undefined;
	readonly pairing: CandidatePairing;
	readonly right: Span | undefined;
}

// No-crossing binds a pair of pairings only where both carry a span on the same
// side. Overlapping spans on a side interleave it; strict orders that disagree
// across the two sides are a directional inversion, reported against the right,
// which runs backwards relative to the left order. A side one pairing leaves
// unanchored imposes nothing, so a special-only side never manufactures a
// crossing.
const collectCrossing = (
	first: AnchoredPairing,
	second: AnchoredPairing,
	crossings: Crossing[],
): void => {
	const leftOrder =
		first.left && second.left ? orderSpans(first.left, second.left) : undefined;
	const rightOrder =
		first.right && second.right
			? orderSpans(first.right, second.right)
			: undefined;

	if (leftOrder === "overlap") {
		crossings.push({
			earlier: first.pairing,
			later: second.pairing,
			side: "left",
		});
	}
	if (rightOrder === "overlap") {
		crossings.push({
			earlier: first.pairing,
			later: second.pairing,
			side: "right",
		});
	}
	if (
		leftOrder !== undefined &&
		leftOrder !== "overlap" &&
		rightOrder !== undefined &&
		rightOrder !== "overlap" &&
		leftOrder !== rightOrder
	) {
		const [earlier, later] =
			leftOrder === "before"
				? [first.pairing, second.pairing]
				: [second.pairing, first.pairing];
		crossings.push({ earlier, later, side: "right" });
	}
};

// Legal alignments preserve both sequences' relative order: gaps and split or
// merged runs are fine, but two pairings may never overlap or cross. Every pair
// of admitted pairings is compared directly, so a pairing anchored on only one
// side constrains nothing on the other and cannot false-conflict.
const checkMonotonic = (
	pairings: readonly CandidatePairing[],
	leftIndex: StreamIndex,
	rightIndex: StreamIndex,
): MonotonicVerdict => {
	const anchored = pairings
		.filter((pairing) => touchesMainSequence(pairing, leftIndex, rightIndex))
		.map((pairing) => ({
			left: spanOf(pairing.left, leftIndex, "left"),
			pairing,
			right: spanOf(pairing.right, rightIndex, "right"),
		}));

	const crossings: Crossing[] = [];
	for (const [position, first] of anchored.entries()) {
		for (const second of anchored.slice(position + 1)) {
			collectCrossing(first, second, crossings);
		}
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
