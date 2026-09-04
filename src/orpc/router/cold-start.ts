import type { Promisable } from "type-fest";

import {
	readGraph,
	statusUrlFor,
	WARM_RETRY_AFTER_SECONDS,
} from "@/engine/gateway";
import type { GraphRead } from "@/engine/gateway";
import type { Identity, Profile } from "@/engine/identity.ts";
import { createLiveColdLookup, resolveIngestEnv } from "@/engine/ingest";
import type { IngestEnv } from "@/engine/ingest";
import { targetPlansFor } from "@/engine/ingest/plannable.ts";
import type { AdminIngestStartResult } from "@/orpc/schema";

type ResolveIngest = () => Promisable<IngestEnv>;

const pending = (
	statusUrl: string,
	retryAfterSeconds: number,
): AdminIngestStartResult => ({
	kind: "pending",
	retryAfterSeconds,
	statusUrl,
});

const outcomeFor = (
	graph: GraphRead,
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

interface ColdStartResult {
	readonly db: IngestEnv["db"];
	readonly graph: GraphRead;
	readonly outcome: AdminIngestStartResult;
}

const runColdStart = async (
	identity: Identity,
	profile: Profile,
	resolveIngest?: ResolveIngest,
): Promise<ColdStartResult> => {
	const ingest = await (resolveIngest ?? resolveIngestEnv)();
	const warm = await readGraph(ingest.db, identity);
	const warmOutcome = outcomeFor(warm, identity, profile);
	if (warmOutcome !== undefined) {
		return { db: ingest.db, graph: warm, outcome: warmOutcome };
	}

	await createLiveColdLookup({
		resolveIngest: () => ingest,
	}).begin(identity, profile);

	const afterCold = await readGraph(ingest.db, identity);
	const coldOutcome = outcomeFor(afterCold, identity, profile);
	if (coldOutcome !== undefined) {
		return { db: ingest.db, graph: afterCold, outcome: coldOutcome };
	}
	if (warm.found) {
		return {
			db: ingest.db,
			graph: afterCold.found ? afterCold : warm,
			outcome: {
				kind: "retryable",
				retryAfterSeconds: WARM_RETRY_AFTER_SECONDS,
			},
		};
	}
	return { db: ingest.db, graph: afterCold, outcome: { kind: "unknown" } };
};

export { runColdStart };
export type { ColdStartResult };
