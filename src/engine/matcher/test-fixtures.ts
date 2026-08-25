import type { InstalmentLocator } from "@/db/schema";

import type { Instalment, InstalmentStream, StreamBoundary } from "./instalment.ts";
import type { Tier } from "./ladder.ts";
import type { CandidatePairing, NonEmptyArray } from "./monotonic.ts";

const locator = (raw: string): InstalmentLocator => raw;

const locators = (
	raws: NonEmptyArray<string>,
): NonEmptyArray<InstalmentLocator> => {
	const [head, ...tail] = raws;
	return [locator(head), ...tail.map((raw) => locator(raw))];
};

const pair = (
	left: NonEmptyArray<string>,
	right: NonEmptyArray<string>,
): CandidatePairing => ({
	left: locators(left),
	right: locators(right),
});

const regular = (raw: string): Instalment => ({
	kind: "regular",
	locator: locator(raw),
});

const special = (raw: string): Instalment => ({
	kind: "special",
	locator: locator(raw),
});

const streamOf = (
	instalments: readonly Instalment[],
	boundary: StreamBoundary = "complete",
): InstalmentStream => ({ boundary, instalments });

const staticTier = (
	id: Tier["id"],
	pairings: readonly CandidatePairing[],
): Tier => ({ id, propose: () => ({ pairings }) });

export { locator, locators, pair, regular, special, staticTier, streamOf };
