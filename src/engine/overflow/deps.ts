import { and, eq } from "drizzle-orm";

import { serviceTitles } from "@/db/engine-schema";
import type { InstalmentLocator } from "@/db/schema";
import type {
	DiscoveryClients,
	EnumeratedTitle,
	MemberMapping,
} from "@/engine/discovery/structural.ts";
import { toGraphMember } from "@/engine/gateway/keys.ts";
import type { Profile, Service, TitleIdentity } from "@/engine/identity.ts";
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
import { commitPublish, finishPublish } from "@/engine/ingest/publish.ts";
import type {
	InstalmentFacts,
	PublishedAlignment,
	TierId,
} from "@/engine/matcher";

import type { BuildDeps } from "./build.ts";
import { seedPendingCoverage } from "./coverage.ts";
import type { GroupCoverageKey } from "./coverage.ts";
import type { BuildPayload } from "./work.ts";

const DEFAULT_BUDGET = 10;

type SerializedFacts = readonly (readonly [
	InstalmentLocator,
	InstalmentFacts,
])[];

interface SerializableEnumerated {
	readonly facts: SerializedFacts;
	readonly stream: EnumeratedTitle["stream"];
}

interface OverflowChain {
	readonly anchor: TitleIdentity;
	readonly budget: number;
	readonly continuity: GroupCoverageKey;
	readonly groupId: number;
	readonly outcome: DiscoverPhaseOutcome;
	readonly profile: Profile;
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

const emptyEnumerated = (): SerializableEnumerated => ({
	facts: [],
	stream: { boundary: "complete", instalments: [] },
});

const serializeEnumerated = (
	title: EnumeratedTitle,
): SerializableEnumerated => ({
	facts: [...title.facts],
	stream: title.stream,
});

const deserializeEnumerated = (
	title: SerializableEnumerated,
): EnumeratedTitle => ({
	facts: new Map(title.facts),
	stream: title.stream,
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

const createBuildDeps = (
	ingest: IngestEnv,
	payload: BuildPayload,
): BuildDeps<OverflowChain, OverflowStreams, OverflowAlignment> => {
	const { db } = ingest;
	const { identity, profile, work } = payload;
	if (identity.kind !== "title") {
		throw new Error("overflow deps: instalment identities are not supported");
	}
	const { continuity } = work;
	const revision = work.baselineRevision;
	const { targetService } = work;
	const groupId = groupIdFromContinuity(continuity);
	const discovery: DiscoveryClients | undefined = ingest.structuralDiscovery;
	const budget = DEFAULT_BUDGET;
	const anchor = identity.title;

	return {
		align: async ({ chain, streams }) => {
			if (streams.skip !== undefined) {
				const anchorTitleId = await anchorTitleIdFor(db, groupId, anchor);
				return skippedAlignment(streams, anchorTitleId);
			}
			const { mapping } = streams;
			const discovered = chain.outcome;
			if (mapping === undefined || discovered.kind !== "discovered") {
				const anchorTitleId = await anchorTitleIdFor(db, groupId, anchor);
				return skippedAlignment(streams, anchorTitleId);
			}
			const anchorTitleId = await anchorTitleIdFor(db, groupId, anchor);
			const aligned = alignTarget({
				anchor: await anchorStreamFromDb(db, anchorTitleId),
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
		},
		discover: async () => {
			if (discovery === undefined) {
				return {
					anchor,
					budget,
					continuity,
					groupId,
					outcome: { kind: "no-group" } as const,
					profile,
					revision,
					targetService,
				};
			}
			const outcome = await discoverGroup({
				anchor,
				budget,
				clients: discovery,
			});
			return {
				anchor,
				budget,
				continuity,
				groupId,
				outcome,
				profile,
				revision,
				targetService,
			};
		},
		fetchTarget: async (chain) => {
			if (chain.outcome.kind !== "discovered") {
				return {
					chain,
					enumerated: emptyEnumerated(),
					skip: "no-group" as const,
				};
			}
			const mapping = targetMappingFor(chain.outcome.discovered, targetService);
			if (mapping === undefined) {
				return {
					chain,
					enumerated: emptyEnumerated(),
					skip: "no-mapping" as const,
				};
			}
			if (discovery === undefined) {
				throw new Error("overflow deps: structural discovery clients missing");
			}
			const fetched = await fetchTargetStream({
				clients: discovery,
				target: mapping.member,
			});
			if (fetched.kind === "unavailable") {
				throw new Error(`${targetService} upstream unavailable`);
			}
			return {
				chain,
				enumerated: serializeEnumerated(fetched.enumerated),
				mapping,
				skip: undefined,
			};
		},
		publish: async (alignment) => {
			if (alignment.skip || alignment.mapping === undefined) {
				const result = await finishPublish(db, alignment.publishContext);
				if (result.kind !== "published") {
					throw new Error(`overflow publish refused: ${result.kind}`);
				}
				return;
			}
			const { discovered } = alignment;
			if (discovered === undefined) {
				throw new Error("overflow deps: discovered group missing for publish");
			}
			const result = await commitPublish(db, {
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
		},
		seedPending: async () => {
			await seedPendingCoverage(db, continuity, revision, targetService);
		},
	};
};

export { createBuildDeps };
export type {
	OverflowAlignment,
	OverflowChain,
	OverflowStreams,
	SerializableEnumerated,
};
