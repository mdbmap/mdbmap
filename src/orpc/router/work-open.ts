import { and, eq } from "drizzle-orm";

import { serviceTitles } from "@/db/engine-schema";
import { continuityKey } from "@/engine/continuity/keys";
import { ensureGroupContinuity } from "@/engine/continuity/persist";
import type { GraphRead } from "@/engine/gateway";
import { toGraphMember } from "@/engine/gateway/keys.ts";
import { survivorGroupId } from "@/engine/gateway/read.ts";
import type { Identity } from "@/engine/identity.ts";
import { pub } from "@/orpc/base";
import type { Db } from "@/orpc/context";
import type { AdminIngestStartResult, WorkOpenResult } from "@/orpc/schema";
import { WorkOpenInput } from "@/orpc/schema";

import { runColdStart } from "./cold-start";

const continuityForGraph = async (
	db: Db,
	identity: Identity,
	graph: GraphRead,
): Promise<string | undefined> => {
	if (graph.found && graph.continuityId !== undefined) {
		return continuityKey(graph.continuityId);
	}
	const member = toGraphMember(identity.title);
	const title = await db
		.select({ groupId: serviceTitles.groupId })
		.from(serviceTitles)
		.where(
			and(
				eq(serviceTitles.service, member.service),
				eq(serviceTitles.serviceId, member.serviceId),
			),
		)
		.get();
	if (title === undefined) {
		return;
	}
	const groupId = await survivorGroupId(db, title.groupId);
	return continuityKey(await ensureGroupContinuity(db, groupId));
};

const toOpenResult = async (
	db: Db,
	identity: Identity,
	graph: GraphRead,
	outcome: AdminIngestStartResult,
): Promise<WorkOpenResult> => {
	switch (outcome.kind) {
		case "complete": {
			const continuityId = await continuityForGraph(db, identity, graph);
			return continuityId === undefined
				? { kind: "unknown" }
				: { continuityId, kind: "ready" };
		}
		case "pending": {
			const continuityId = await continuityForGraph(db, identity, graph);
			return continuityId === undefined
				? { kind: "unknown" }
				: {
						continuityId,
						kind: "pending",
						retryAfterSeconds: outcome.retryAfterSeconds,
						statusUrl: outcome.statusUrl,
					};
		}
		case "retryable": {
			const continuityId = await continuityForGraph(db, identity, graph);
			return continuityId === undefined
				? { kind: "unknown" }
				: {
						continuityId,
						kind: "pending",
						retryAfterSeconds: outcome.retryAfterSeconds,
					};
		}
		case "conflict": {
			return { kind: "conflict", review: outcome.review };
		}
		case "unknown": {
			return { kind: "unknown" };
		}
	}
};

const open = pub
	.input(WorkOpenInput)
	.handler(async ({ context, input }): Promise<WorkOpenResult> => {
		const { db, graph, outcome } = await runColdStart(
			input.identity,
			input.profile,
			context.resolveIngest,
		);
		return toOpenResult(db, input.identity, graph, outcome);
	});

export { open };
