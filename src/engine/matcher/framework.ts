import type { InstalmentLocator } from "@/db/schema";

import type { InstalmentStream } from "./instalment.ts";
import type { CandidatePairing, Crossing } from "./monotonic.ts";
import { checkMonotonic, indexStream } from "./monotonic.ts";

interface AlignedPair {
	readonly left: readonly InstalmentLocator[];
	readonly right: readonly InstalmentLocator[];
}

// `noCounterpart` is an explicit `[]` from a completed stream; `pending` is an
// airing stream's unmapped position, which never hardens into no-counterpart.
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
	| { readonly reason: "truncated-fetch"; readonly status: "unpublishable" };

const disposeSide = (
	stream: InstalmentStream,
	paired: ReadonlySet<InstalmentLocator>,
): SideDisposition => {
	const noCounterpart: InstalmentLocator[] = [];
	const pending: InstalmentLocator[] = [];
	for (const instalment of stream.instalments) {
		if (paired.has(instalment.locator)) {
			continue;
		}
		if (stream.boundary === "airing") {
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
const alignStreams = (
	left: InstalmentStream,
	right: InstalmentStream,
	pairings: readonly CandidatePairing[],
): AlignmentOutcome => {
	if (left.boundary === "truncated" || right.boundary === "truncated") {
		return { reason: "truncated-fetch", status: "unpublishable" };
	}
	const leftIndex = indexStream(left);
	const rightIndex = indexStream(right);
	const verdict = checkMonotonic(pairings, leftIndex, rightIndex);
	if (!verdict.ok) {
		return { crossings: verdict.crossings, status: "conflict" };
	}
	const leftPaired = new Set<InstalmentLocator>();
	const rightPaired = new Set<InstalmentLocator>();
	const pairs: AlignedPair[] = pairings.map((pairing) => {
		for (const locator of pairing.left) {
			leftPaired.add(locator);
		}
		for (const locator of pairing.right) {
			rightPaired.add(locator);
		}
		return { left: pairing.left, right: pairing.right };
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
export type { AlignedPair, AlignmentOutcome, PublishedAlignment, SideDisposition };
