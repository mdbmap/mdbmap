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
import type { IngestEnv } from "@/engine/ingest/env.ts";
import {
	alignmentFromMappedPairs,
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
import { ensureSpokes, ensureTitle } from "@/engine/ingest/spokes.ts";
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
	readonly leavePending?: boolean;
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
	await writeCoverageState(
		ctx.db,
		ctx.continuity,
		ctx.revision,
		ctx.targetService,
		"conflict",
	);
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
	await queueAlignmentCrossingConflicts(ctx.db, {
		anchorTitleId: input.anchorTitleId,
		crossings: input.crossings,
		evidenceHashPrefix: "overflow-alignment-conflict",
		targetTitleId,
		triedSource: input.triedSource,
	});
};

const overflowDiscover = async (
	ctx: OverflowContext,
): Promise<OverflowChain> => {
	const outcome =
		ctx.discovery === undefined
			? { kind: "no-group" as const }
			: await discoverGroup({
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
		return { chain, enumerated: emptyEnumerated(), skip: "refused" };
	}
	if (chain.outcome.kind !== "discovered") {
		return { chain, enumerated: emptyEnumerated(), skip: "no-group" };
	}
	const mapping = targetMappingFor(chain.outcome.discovered, ctx.targetService);
	if (mapping === undefined) {
		return { chain, enumerated: emptyEnumerated(), skip: "no-mapping" };
	}
	if (ctx.discovery === undefined) {
		return {
			chain,
			enumerated: emptyEnumerated(),
			mapping,
			skip: "no-mapping",
		};
	}
	const fetched = await fetchTargetStream({
		clients: ctx.discovery,
		target: mapping.member,
	});
	if (fetched.kind === "unavailable") {
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
		const anchorTitleId = await anchorTitleIdFor(
			ctx.db,
			ctx.groupId,
			ctx.anchor,
		);
		return {
			...skippedAlignment(streams, anchorTitleId),
			...(streams.skip === "refused" || streams.skip === "unavailable-target"
				? { leavePending: true }
				: {}),
		};
	}
	const anchorTitleId = await anchorTitleIdFor(ctx.db, ctx.groupId, ctx.anchor);
	const targetEnumerated = deserializeEnumerated(streams.enumerated);
	const sharedFetched =
		ctx.discovery === undefined
			? { kind: "unavailable" as const }
			: await fetchTargetStream({
					clients: ctx.discovery,
					target: discovered.discovered.shared,
				});
	const anchorStream =
		sharedFetched.kind === "fetched"
			? sharedFetched.enumerated.stream
			: await anchorStreamFromDb(ctx.db, anchorTitleId);

	if (mapping.pairs.length > 0) {
		return {
			alignment: alignmentFromMappedPairs(
				anchorStream,
				targetEnumerated.stream,
				mapping.pairs,
			),
			anchorTitleId,
			discovered: discovered.discovered,
			enumerated: streams.enumerated,
			mapping,
			publishContext: publishContextFor(chain),
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
		skip: false,
		triedSource: highestTriedTier(aligned.ladder),
	};
};

const overflowPublish = async (
	ctx: OverflowContext,
	alignment: OverflowAlignment,
): Promise<void> => {
	if (alignment.skip || alignment.mapping === undefined) {
		if (alignment.leavePending) {
			return;
		}
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
