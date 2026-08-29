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

const start = admin
	.input(IngestStartInput)
	.handler(async ({ context, input }): Promise<AdminIngestStartResult> => {
		const ingest = await (context.resolveIngest ?? resolveIngestEnv)();
		const cold = await createLiveColdLookup({
			resolveIngest: () => ingest,
		}).begin(input.identity, input.profile);
		if (cold.kind === "miss") {
			return { kind: "unknown" };
		}
		if (cold.kind === "started") {
			return pending(cold.build.statusUrl, cold.build.retryAfterSeconds);
		}
		const graph = await readGraph(ingest.db, input.identity);
		if (graph.found && graph.pendingRef !== undefined) {
			return pending(
				`/api/engine/status/${graph.pendingRef}`,
				RETRY_AFTER_SECONDS,
			);
		}
		return graph.found ? { kind: "complete" } : { kind: "unknown" };
	});

const ingest = { start };

export { ingest };
