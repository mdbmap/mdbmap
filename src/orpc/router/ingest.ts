import { readGraph } from "@/engine/gateway";
import { createLiveColdLookup, resolveIngestEnv } from "@/engine/ingest";
import { admin } from "@/orpc/base";
import type { AdminIngestStartResult } from "@/orpc/schema";
import { IngestStartInput } from "@/orpc/schema";

const RETRY_AFTER_SECONDS = 5;

const pending = (
	statusUrl: string,
	retryAfterSeconds: number,
): AdminIngestStartResult => ({
	kind: "pending",
	retryAfterSeconds,
	statusUrl,
});

const outcomeFor = (
	graph: Awaited<ReturnType<typeof readGraph>>,
): AdminIngestStartResult | undefined => {
	if (!graph.found) {
		return;
	}
	if (graph.pendingRef !== undefined) {
		return pending(
			`/api/engine/status/${graph.pendingRef}`,
			RETRY_AFTER_SECONDS,
		);
	}
	return { kind: "complete" };
};

const start = admin
	.input(IngestStartInput)
	.handler(async ({ context, input }): Promise<AdminIngestStartResult> => {
		const ingest = await (context.resolveIngest ?? resolveIngestEnv)();
		const warm = await readGraph(ingest.db, input.identity);
		const warmOutcome = outcomeFor(warm);
		if (warmOutcome !== undefined) {
			return warmOutcome;
		}

		await createLiveColdLookup({
			resolveIngest: () => ingest,
		}).begin(input.identity, input.profile);

		const afterCold = await readGraph(ingest.db, input.identity);
		const coldOutcome = outcomeFor(afterCold);
		if (coldOutcome !== undefined) {
			return coldOutcome;
		}
		return { kind: "unknown" };
	});

const ingest = { start };

export { ingest };
