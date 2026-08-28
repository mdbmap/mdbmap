import { and, eq } from "drizzle-orm";

import { serviceTitles } from "@/db/engine-schema";
import type {
	DiscoveryClients,
	EnumeratedTitle,
	MemberMapping,
} from "@/engine/discovery/structural.ts";
import { toGraphMember } from "@/engine/gateway/keys.ts";
import type { Service, TitleIdentity } from "@/engine/identity.ts";
import { queueAlignmentCrossingConflicts } from "@/engine/ingest/alignment-conflict.ts";
import { instalmentEnumerableServices } from "@/engine/ingest/enumerable-services.ts";
import type { IngestEnv } from "@/engine/ingest/env.ts";
import {
	alignmentFromMappedPairs,
	alignTarget,
	discoverGroup,
	fetchTargetStream,
	highestTriedTier,
	targetMappingFor,
} from "@/engine/ingest/phases.ts";
import type {
	DiscoverPhaseOutcome,
	DiscoveredGroup,
} from "@/engine/ingest/phases.ts";
import { DEFAULT_BUDGET, commitPublish } from "@/engine/ingest/publish.ts";
import { ensureSpokes, ensureTitle } from "@/engine/ingest/spokes.ts";
import { buildStructuralDiscoveryClients } from "@/engine/ingest/structural-discovery.ts";
import type { Crossing, PublishedAlignment, TierId } from "@/engine/matcher";

import type { BuildDeps } from "./build.ts";
import { seedPendingCoverage, writeCoverageState } from "./coverage.ts";
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

type OverflowFetchSkip =
	| "no-group"
	| "no-mapping"
	| "refused"
	| "unavailable-target";

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
	readonly sharedEnumerated?: SerializableEnumerated;
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
	readonly discovery: DiscoveryClients | undefined;
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

const recordAlignmentConflict = async (
	ctx: OverflowContext,
	input: {
		readonly anchorTitleId: number;
		readonly crossings: readonly Crossing[];
		readonly enumerated: SerializableEnumerated;
		readonly mapping: MemberMapping;
		readonly sharedEnumerated?: EnumeratedTitle;
		readonly triedSource: TierId;
	},
): Promise<void> => {
	const targetTitleId = await ensureTitle(
		ctx.db,
		ctx.groupId,
		input.mapping.member,
		input.mapping.ordinal,
	);
	if (input.sharedEnumerated !== undefined) {
		await ensureSpokes(ctx.db, input.anchorTitleId, input.sharedEnumerated);
	}
	await ensureSpokes(
		ctx.db,
		targetTitleId,
		deserializeEnumerated(input.enumerated),
	);
	const queued = await queueAlignmentCrossingConflicts(ctx.db, {
		anchorTitleId: input.anchorTitleId,
		crossings: input.crossings,
		evidenceHashPrefix: "overflow-alignment-conflict",
		targetTitleId,
		triedSource: input.triedSource,
	});
	if (!queued) {
		throw new Error(
			"overflow deps: alignment conflict without queueable spokes",
		);
	}
	await writeCoverageState(
		ctx.db,
		ctx.continuity,
		ctx.revision,
		ctx.targetService,
		"conflict",
	);
};

const discoveryClientsFor = (ctx: OverflowContext): DiscoveryClients =>
	ctx.discovery ?? buildStructuralDiscoveryClients({});

const overflowPendingError = (targetService: Service): Error =>
	new Error(`overflow align: ${targetService} coverage pending`);

const overflowDiscover = async (
	ctx: OverflowContext,
): Promise<OverflowChain> => {
	if (!instalmentEnumerableServices.has(ctx.targetService)) {
		return {
			budget: ctx.budget,
			continuity: ctx.continuity,
			groupId: ctx.groupId,
			outcome: { kind: "refused", reason: "unmappable-member" },
			revision: ctx.revision,
			targetService: ctx.targetService,
		};
	}
	const outcome = await discoverGroup({
		anchor: ctx.anchor,
		budget: ctx.budget,
		clients: discoveryClientsFor(ctx),
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
		return { chain, enumerated: emptyEnumerated(), skip: "refused" };
	}
	if (chain.outcome.kind !== "discovered") {
		return { chain, enumerated: emptyEnumerated(), skip: "no-group" };
	}
	const mapping = targetMappingFor(chain.outcome.discovered, ctx.targetService);
	if (mapping === undefined) {
		return { chain, enumerated: emptyEnumerated(), skip: "no-mapping" };
	}
	const fetched = await fetchTargetStream({
		clients: discoveryClientsFor(ctx),
		target: mapping.member,
	});
	if (fetched.kind === "unavailable") {
		if (fetched.reason === "fetch-failed") {
			throw new Error(`${ctx.targetService} upstream unavailable`);
		}
		return {
			chain,
			enumerated: emptyEnumerated(),
			mapping,
			skip: "unavailable-target",
		};
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
		if (streams.skip === "unavailable-target") {
			const anchorTitleId = await anchorTitleIdFor(
				ctx.db,
				ctx.groupId,
				ctx.anchor,
			);
			return skippedAlignment(streams, anchorTitleId);
		}
		if (
			streams.skip === "refused" ||
			streams.skip === "no-group" ||
			streams.skip === "no-mapping"
		) {
			if (!instalmentEnumerableServices.has(ctx.targetService)) {
				const anchorTitleId = await anchorTitleIdFor(
					ctx.db,
					ctx.groupId,
					ctx.anchor,
				);
				return skippedAlignment(streams, anchorTitleId);
			}
			throw overflowPendingError(ctx.targetService);
		}
		const anchorTitleId = await anchorTitleIdFor(
			ctx.db,
			ctx.groupId,
			ctx.anchor,
		);
		return skippedAlignment(streams, anchorTitleId);
	}
	const anchorTitleId = await anchorTitleIdFor(ctx.db, ctx.groupId, ctx.anchor);
	const targetEnumerated = deserializeEnumerated(streams.enumerated);
	const sharedFetched = await fetchTargetStream({
		clients: discoveryClientsFor(ctx),
		target: discovered.discovered.shared,
	});
	if (sharedFetched.kind !== "fetched") {
		if (sharedFetched.reason === "not-enumerable") {
			return skippedAlignment(streams, anchorTitleId);
		}
		throw overflowPendingError(ctx.targetService);
	}
	const anchorStream = sharedFetched.enumerated.stream;

	if (mapping.pairs.length > 0) {
		const mappedAlignment = alignmentFromMappedPairs(
			anchorStream,
			targetEnumerated.stream,
			mapping.pairs,
		);
		if (mappedAlignment === undefined) {
			throw new Error("overflow deps: truncated fetch");
		}
		return {
			alignment: mappedAlignment,
			anchorTitleId,
			discovered: discovered.discovered,
			enumerated: streams.enumerated,
			mapping,
			publishContext: publishContextFor(chain),
			sharedEnumerated: serializeEnumerated(sharedFetched.enumerated),
			skip: false,
			triedSource: "t3-episode",
		};
	}

	const aligned = alignTarget({
		anchor: anchorStream,
		...(sharedFetched.kind === "fetched"
			? { anchorFacts: sharedFetched.enumerated.facts }
			: {}),
		budget: chain.budget,
		target: targetEnumerated,
	});
	if (aligned.kind === "over-budget") {
		throw new Error("overflow deps: alignment over budget");
	}
	if (
		aligned.alignment === undefined ||
		aligned.alignment.status !== "published"
	) {
		if (aligned.alignment?.status === "conflict") {
			await recordAlignmentConflict(ctx, {
				anchorTitleId,
				crossings: aligned.alignment.crossings,
				enumerated: streams.enumerated,
				mapping,
				...(sharedFetched.kind === "fetched"
					? { sharedEnumerated: sharedFetched.enumerated }
					: {}),
				triedSource: highestTriedTier(aligned.ladder),
			});
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
		sharedEnumerated: serializeEnumerated(sharedFetched.enumerated),
		skip: false,
		triedSource: highestTriedTier(aligned.ladder),
	};
};

const overflowPublish = async (
	ctx: OverflowContext,
	alignment: OverflowAlignment,
): Promise<void> => {
	if (alignment.skip || alignment.mapping === undefined) {
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
		...(alignment.sharedEnumerated === undefined
			? {}
			: {
					sharedEnumeration: deserializeEnumerated(alignment.sharedEnumerated),
				}),
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
