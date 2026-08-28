import { and, eq } from "drizzle-orm";

import { serviceTitles } from "@/db/engine-schema";
import type {
	DiscoveryClients,
	MemberMapping,
} from "@/engine/discovery/structural.ts";
import { toGraphMember } from "@/engine/gateway/keys.ts";
import type { Service, TitleIdentity } from "@/engine/identity.ts";
import type { IngestEnv } from "@/engine/ingest/env.ts";
import {
	alignTarget,
	anchorStreamFromDb,
	discoverGroup,
	fetchTargetStream,
	highestTriedTier,
	targetMappingFor,
} from "@/engine/ingest/phases.ts";
import type {
	DiscoverPhaseOutcome,
	DiscoveredGroup,
} from "@/engine/ingest/phases.ts";
import {
	DEFAULT_BUDGET,
	commitPublish,
	finishPublish,
} from "@/engine/ingest/publish.ts";
import type { PublishedAlignment, TierId } from "@/engine/matcher";

import type { BuildDeps } from "./build.ts";
import { seedPendingCoverage } from "./coverage.ts";
import type { GroupCoverageKey } from "./coverage.ts";
import {
	deserializeEnumerated,
	emptyEnumerated,
	serializeEnumerated,
} from "./serializable.ts";
import type { SerializableEnumerated } from "./serializable.ts";
import type { BuildPayload } from "./work.ts";

interface OverflowChain {
	readonly budget: number;
	readonly continuity: GroupCoverageKey;
	readonly groupId: number;
	readonly outcome: DiscoverPhaseOutcome;
	readonly revision: number;
	readonly targetService: Service;
}

type OverflowFetchSkip = "no-group" | "no-mapping";

interface OverflowStreams {
	readonly chain: OverflowChain;
	readonly enumerated: SerializableEnumerated;
	readonly mapping?: MemberMapping;
	readonly skip: OverflowFetchSkip | undefined;
}

interface OverflowAlignment {
	readonly alignment: PublishedAlignment;
	readonly anchorTitleId: number;
	readonly discovered?: DiscoveredGroup;
	readonly enumerated: SerializableEnumerated;
	readonly mapping?: MemberMapping;
	readonly publishContext: {
		readonly continuity: GroupCoverageKey;
		readonly groupId: number;
		readonly revision: number;
		readonly targetService: Service;
	};
	readonly skip: boolean;
	readonly triedSource: TierId;
}

const emptyAlignment = (): PublishedAlignment => ({
	left: { noCounterpart: [], pending: [] },
	pairs: [],
	right: { noCounterpart: [], pending: [] },
});

const groupIdFromContinuity = (continuity: GroupCoverageKey): number =>
	Number(continuity.slice("group:".length));

const anchorTitleIdFor = async (
	db: IngestEnv["db"],
	groupId: number,
	title: TitleIdentity,
): Promise<number> => {
	const member = toGraphMember(title);
	const row = await db
		.select({ id: serviceTitles.id })
		.from(serviceTitles)
		.where(
			and(
				eq(serviceTitles.groupId, groupId),
				eq(serviceTitles.service, member.service),
				eq(serviceTitles.serviceId, member.serviceId),
			),
		)
		.get();
	if (row === undefined) {
		throw new Error(
			"overflow deps: anchor title missing for bootstrapped group",
		);
	}
	return row.id;
};

const publishContextFor = (chain: OverflowChain) => ({
	continuity: chain.continuity,
	groupId: chain.groupId,
	revision: chain.revision,
	targetService: chain.targetService,
});

interface OverflowContext {
	readonly anchor: TitleIdentity;
	readonly budget: number;
	readonly continuity: GroupCoverageKey;
	readonly db: IngestEnv["db"];
	readonly discovery: DiscoveryClients;
	readonly groupId: number;
	readonly revision: number;
	readonly targetService: Service;
}

const skippedAlignment = (
	streams: OverflowStreams,
	anchorTitleId: number,
): OverflowAlignment => ({
	alignment: emptyAlignment(),
	anchorTitleId,
	enumerated: streams.enumerated,
	...(streams.mapping === undefined ? {} : { mapping: streams.mapping }),
	publishContext: publishContextFor(streams.chain),
	skip: true,
	triedSource: "t3-episode",
});

const overflowDiscover = async (
	ctx: OverflowContext,
): Promise<OverflowChain> => {
	const outcome = await discoverGroup({
		anchor: ctx.anchor,
		budget: ctx.budget,
		clients: ctx.discovery,
	});
	return {
		budget: ctx.budget,
		continuity: ctx.continuity,
		groupId: ctx.groupId,
		outcome,
		revision: ctx.revision,
		targetService: ctx.targetService,
	};
};

const overflowFetch = async (
	ctx: OverflowContext,
	chain: OverflowChain,
): Promise<OverflowStreams> => {
	if (chain.outcome.kind === "refused") {
		throw new Error(
			`overflow deps: discovery refused (${chain.outcome.reason})`,
		);
	}
	if (chain.outcome.kind !== "discovered") {
		return { chain, enumerated: emptyEnumerated(), skip: "no-group" };
	}
	const mapping = targetMappingFor(chain.outcome.discovered, ctx.targetService);
	if (mapping === undefined) {
		return { chain, enumerated: emptyEnumerated(), skip: "no-mapping" };
	}
	const fetched = await fetchTargetStream({
		clients: ctx.discovery,
		target: mapping.member,
	});
	if (fetched.kind === "unavailable") {
		throw new Error(`${ctx.targetService} upstream unavailable`);
	}
	return {
		chain,
		enumerated: serializeEnumerated(fetched.enumerated),
		mapping,
		skip: undefined,
	};
};

const overflowAlign = async (
	ctx: OverflowContext,
	chain: OverflowChain,
	streams: OverflowStreams,
): Promise<OverflowAlignment> => {
	const { mapping } = streams;
	const discovered = chain.outcome;
	if (
		streams.skip !== undefined ||
		mapping === undefined ||
		discovered.kind !== "discovered"
	) {
		return skippedAlignment(
			streams,
			await anchorTitleIdFor(ctx.db, ctx.groupId, ctx.anchor),
		);
	}
	const anchorTitleId = await anchorTitleIdFor(ctx.db, ctx.groupId, ctx.anchor);
	const aligned = alignTarget({
		anchor: await anchorStreamFromDb(ctx.db, anchorTitleId),
		budget: chain.budget,
		target: deserializeEnumerated(streams.enumerated),
	});
	if (aligned.kind === "over-budget") {
		throw new Error("overflow deps: alignment over budget");
	}
	if (
		aligned.alignment === undefined ||
		aligned.alignment.status !== "published"
	) {
		if (aligned.alignment?.status === "conflict") {
			throw new Error("overflow deps: alignment conflict");
		}
		throw new Error("overflow deps: unpublishable alignment");
	}
	return {
		alignment: aligned.alignment.alignment,
		anchorTitleId,
		discovered: discovered.discovered,
		enumerated: streams.enumerated,
		mapping,
		publishContext: publishContextFor(chain),
		skip: false,
		triedSource: highestTriedTier(aligned.ladder),
	};
};

const overflowPublish = async (
	ctx: OverflowContext,
	alignment: OverflowAlignment,
): Promise<void> => {
	if (alignment.skip || alignment.mapping === undefined) {
		const result = await finishPublish(ctx.db, alignment.publishContext);
		if (result.kind !== "published") {
			throw new Error(`overflow publish refused: ${result.kind}`);
		}
		return;
	}
	const { discovered } = alignment;
	if (discovered === undefined) {
		throw new Error("overflow deps: discovered group missing for publish");
	}
	const result = await commitPublish(ctx.db, {
		alignment: alignment.alignment,
		anchorTitleId: alignment.anchorTitleId,
		continuity: alignment.publishContext.continuity,
		discovered,
		enumeration: deserializeEnumerated(alignment.enumerated),
		groupId: alignment.publishContext.groupId,
		revision: alignment.publishContext.revision,
		target: alignment.mapping.member,
		targetOrdinal: alignment.mapping.ordinal,
		targetService: alignment.publishContext.targetService,
		triedSource: alignment.triedSource,
	});
	if (result.kind !== "published") {
		throw new Error(`overflow publish refused: ${result.kind}`);
	}
};

const createBuildDeps = (
	ingest: IngestEnv,
	payload: BuildPayload,
): BuildDeps<OverflowChain, OverflowStreams, OverflowAlignment> => {
	const { identity, work } = payload;
	if (identity.kind !== "title") {
		throw new Error("overflow deps: instalment identities are not supported");
	}
	if (ingest.structuralDiscovery === undefined) {
		throw new Error("overflow deps: structural discovery not configured");
	}
	const ctx: OverflowContext = {
		anchor: identity.title,
		budget: DEFAULT_BUDGET,
		continuity: work.continuity,
		db: ingest.db,
		discovery: ingest.structuralDiscovery,
		groupId: groupIdFromContinuity(work.continuity),
		revision: work.baselineRevision,
		targetService: work.targetService,
	};

	return {
		align: async ({ chain, streams }) => overflowAlign(ctx, chain, streams),
		discover: async () => overflowDiscover(ctx),
		fetchTarget: async (chain) => overflowFetch(ctx, chain),
		publish: async (alignment) => overflowPublish(ctx, alignment),
		seedPending: async () =>
			seedPendingCoverage(
				ctx.db,
				ctx.continuity,
				ctx.revision,
				ctx.targetService,
			),
	};
};

export { createBuildDeps };
export type { OverflowAlignment, OverflowChain, OverflowStreams };
export type { SerializableEnumerated } from "./serializable.ts";
