import type { InstalmentLocator } from "@/db/schema";

// A regular instalment sits on the continuity's main sequence and moves later
// offsets; a special (OVA, recap, embedded extra) is matched on its own and
// must not shift the assertions that follow it.
const instalmentKinds = ["regular", "special"] as const;
type InstalmentKind = (typeof instalmentKinds)[number];

// `airing` publishes its released prefix and leaves later positions pending;
// `truncated` retrieved less than the service claims exists and cannot publish.
const streamBoundaries = ["airing", "complete", "truncated"] as const;
type StreamBoundary = (typeof streamBoundaries)[number];

interface Instalment {
	readonly kind: InstalmentKind;
	readonly locator: InstalmentLocator;
}

interface InstalmentStream {
	readonly boundary: StreamBoundary;
	readonly instalments: readonly Instalment[];
}

interface MainSequenceEntry {
	readonly locator: InstalmentLocator;
	readonly offset: number;
}

// Cumulative offsets over regular instalments only: a special between two
// regulars leaves the following regular's offset unchanged.
const mainSequence = (
	stream: InstalmentStream,
): readonly MainSequenceEntry[] => {
	const entries: MainSequenceEntry[] = [];
	let offset = 0;
	for (const instalment of stream.instalments) {
		if (instalment.kind !== "regular") {
			continue;
		}
		offset += 1;
		entries.push({ locator: instalment.locator, offset });
	}
	return entries;
};

export { instalmentKinds, mainSequence, streamBoundaries };
export type {
	Instalment,
	InstalmentKind,
	InstalmentStream,
	MainSequenceEntry,
	StreamBoundary,
};
