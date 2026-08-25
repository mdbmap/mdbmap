import type { InstalmentLocator } from "@/db/schema";

import type { Instalment, InstalmentStream, StreamBoundary } from "./instalment.ts";

const locator = (raw: string): InstalmentLocator => raw;

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

export { locator, regular, special, streamOf };
