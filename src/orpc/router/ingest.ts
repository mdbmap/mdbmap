import {
	readGraph,
	statusUrlFor,
	WARM_RETRY_AFTER_SECONDS,
} from "@/engine/gateway";
import { createLiveColdLookup, resolveIngestEnv } from "@/engine/ingest";
import { admin } from "@/orpc/base";
import type { AdminIngestStartResult } from "@/orpc/schema";
import { IngestStartInput } from "@/orpc/schema";

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
	const statuses = [...graph.answer.links.values()].map((link) => link.status);
	if (statuses.includes("pending") && graph.pendingRef !== undefined) {
		return pending(statusUrlFor(graph.pendingRef), WARM_RETRY_AFTER_SECONDS);
	}
	if (graph.reviewRef !== undefined) {
		return { kind: "conflict", review: graph.reviewRef };
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
