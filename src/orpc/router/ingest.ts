import {
	readGraph,
	statusUrlFor,
	WARM_RETRY_AFTER_SECONDS,
} from "@/engine/gateway";
import type { Identity, Profile } from "@/engine/identity.ts";
import { createLiveColdLookup, resolveIngestEnv } from "@/engine/ingest";
import { targetPlansFor } from "@/engine/ingest/plannable.ts";
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
	identity: Identity,
	profile: Profile,
): AdminIngestStartResult | undefined => {
	if (!graph.found) {
		return;
	}
	const targets = targetPlansFor(identity, profile);
	if (targets.length === 0) {
		return;
	}
	const links = targets.map((target) => graph.answer.links.get(target.service));
	const resolved = links.filter(
		(link): link is NonNullable<typeof link> => link !== undefined,
	);
	if (resolved.length !== links.length) {
		return;
	}
	const statuses = resolved.map((link) => link.status);
	if (statuses.includes("pending") && graph.pendingRef !== undefined) {
		return pending(statusUrlFor(graph.pendingRef), WARM_RETRY_AFTER_SECONDS);
	}
	const usable = statuses.some(
		(status) => status === "matched" || status === "known-no-counterpart",
	);
	if (usable) {
		return { kind: "complete" };
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
		const warmOutcome = outcomeFor(warm, input.identity, input.profile);
		if (warmOutcome !== undefined) {
			return warmOutcome;
		}

		await createLiveColdLookup({
			resolveIngest: () => ingest,
		}).begin(input.identity, input.profile);

		const afterCold = await readGraph(ingest.db, input.identity);
		const coldOutcome = outcomeFor(afterCold, input.identity, input.profile);
		if (coldOutcome !== undefined) {
			return coldOutcome;
		}
		if (warm.found) {
			return {
				kind: "retryable",
				retryAfterSeconds: WARM_RETRY_AFTER_SECONDS,
			};
		}
		return { kind: "unknown" };
	});

const ingest = { start };

export { ingest };
