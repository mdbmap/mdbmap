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

const spanOf = (
	locators: NonEmptyArray<InstalmentLocator>,
	index: StreamIndex,
	side: "left" | "right",
): Span => {
	const positions = locators.map((locator) => {
		const position = index.position.get(locator);
		if (position === undefined) {
			throw new Error(
				`matcher: ${side} locator ${locator} is not in its stream`,
			);
		}
		return position;
	});
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
		.toSorted((first, second) => first.left.min - second.left.min);

	const crossings: Crossing[] = [];
	let leftReach: Reach | undefined;
	let rightReach: Reach | undefined;
	for (const entry of ranked) {
		if (leftReach !== undefined && entry.left.min <= leftReach.max) {
			crossings.push({
				earlier: leftReach.pairing,
				later: entry.pairing,
				side: "left",
			});
		}
		if (rightReach !== undefined && entry.right.min <= rightReach.max) {
			crossings.push({
				earlier: rightReach.pairing,
				later: entry.pairing,
				side: "right",
			});
		}
		if (leftReach === undefined || entry.left.max > leftReach.max) {
			leftReach = { max: entry.left.max, pairing: entry.pairing };
		}
		if (rightReach === undefined || entry.right.max > rightReach.max) {
			rightReach = { max: entry.right.max, pairing: entry.pairing };
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
