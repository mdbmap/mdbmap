import type { Db } from "@/db";
import { ensureGroupContinuity } from "@/engine/continuity/persist.ts";
import { convergeGroups } from "@/engine/discovery/converge.ts";
import type {
	DiscoveryClients,
	EnumeratedTitle,
	ServiceRef,
} from "@/engine/discovery/structural.ts";
import type { Service, TitleIdentity } from "@/engine/identity.ts";
import type { PublishedAlignment } from "@/engine/matcher";
import {
	completeCoverage,
	groupCoverageKey,
	seedPendingCoverage,
} from "@/engine/overflow/coverage.ts";
import { recomputeGroup } from "@/engine/recompute/recompute.ts";
import type { FreshPairing } from "@/engine/recompute/recompute.ts";

import type { BootstrappedGroup } from "./bootstrap.ts";
import {
	alignTarget,
	anchorStreamFromDb,
	convergeMembersOf,
	discoverGroup,
	fetchTargetStream,
	highestTriedTier,
	targetMappingFor,
} from "./phases.ts";
import type { DiscoveredGroup } from "./phases.ts";
import { ensureSpokes, ensureTitle, pairingsFromAlignment } from "./spokes.ts";

const DEFAULT_BUDGET = 10;
const DEFAULT_REVISION = 1;

interface PublishClients {
	readonly discovery: DiscoveryClients;
}

interface SingleTargetPublishInput {
	readonly anchor: TitleIdentity;
	readonly budget?: number;
	readonly clients: PublishClients;
	readonly group: BootstrappedGroup;
	readonly revision?: number;
	readonly targetService: Service;
}

type PublishRefusalReason =
	| "over-budget"
	| "unavailable-target"
	| "unmappable-member"
	| "unpublishable";

type PublishConflictReason = "alignment-conflict" | "converge-candidate";

type PublishResult =
	| { readonly groupId: number; readonly kind: "published" }
	| { readonly kind: "conflict"; readonly reason: PublishConflictReason }
	| { readonly kind: "refused"; readonly reason: PublishRefusalReason };

interface CommitPublishInput {
	readonly alignment: PublishedAlignment;
	readonly anchorTitleId: number;
	readonly continuity: ReturnType<typeof groupCoverageKey>;
	readonly discovered: DiscoveredGroup;
	readonly enumeration: EnumeratedTitle;
	readonly groupId: number;
	readonly revision: number;
	readonly target: ServiceRef;
	readonly targetOrdinal: number;
	readonly targetService: Service;
	readonly triedSource: FreshPairing["source"];
}

const ladderCompleteFor = (alignment: PublishedAlignment): boolean =>
	alignment.left.pending.length === 0 &&
	alignment.left.noCounterpart.length === 0 &&
	alignment.right.pending.length === 0 &&
	alignment.right.noCounterpart.length === 0;

const finishPublish = async (
	db: Db,
	input: {
		readonly continuity: ReturnType<typeof groupCoverageKey>;
		readonly groupId: number;
		readonly revision: number;
		readonly targetService: Service;
	},
): Promise<PublishResult> => {
	await ensureGroupContinuity(db, input.groupId);
	await completeCoverage(
		db,
		input.continuity,
		input.revision,
		input.targetService,
	);
	return { groupId: input.groupId, kind: "published" };
};

const commitPublish = async (
	db: Db,
	input: CommitPublishInput,
): Promise<PublishResult> => {
	const targetTitleId = await ensureTitle(
		db,
		input.groupId,
		input.target,
		input.targetOrdinal,
	);
	await ensureSpokes(db, targetTitleId, input.enumeration);

	const converge = await convergeGroups(db, {
		members: convergeMembersOf(input.discovered),
	});
	if (converge.kind === "candidate") {
		return { kind: "conflict", reason: "converge-candidate" };
	}
	if (converge.kind === "aborted") {
		return { kind: "refused", reason: "unpublishable" };
	}

	const pairings = await pairingsFromAlignment(
		db,
		input.anchorTitleId,
		targetTitleId,
		input.alignment,
		input.triedSource,
	);
	const recompute = await recomputeGroup(db, {
		groupId: input.groupId,
		ladderComplete: ladderCompleteFor(input.alignment),
		pairings,
		triedSource: input.triedSource,
	});
	if (recompute.kind === "aborted") {
		return { kind: "refused", reason: "unpublishable" };
	}

	return finishPublish(db, {
		continuity: input.continuity,
		groupId: input.groupId,
		revision: input.revision,
		targetService: input.targetService,
	});
};

const publishAlignedTarget = async (
	db: Db,
	input: {
		readonly anchorTitleId: number;
		readonly budget: number;
		readonly continuity: ReturnType<typeof groupCoverageKey>;
		readonly discovered: DiscoveredGroup;
		readonly groupId: number;
		readonly mapping: NonNullable<ReturnType<typeof targetMappingFor>>;
		readonly revision: number;
		readonly targetService: Service;
		readonly clients: PublishClients;
	},
): Promise<PublishResult> => {
	const fetched = await fetchTargetStream({
		clients: input.clients.discovery,
		target: input.mapping.member,
	});
	if (fetched.kind === "unavailable") {
		return { kind: "refused", reason: "unavailable-target" };
	}

	const anchorStream = await anchorStreamFromDb(db, input.anchorTitleId);
	const aligned = alignTarget({
		anchor: anchorStream,
		budget: input.budget,
		target: fetched.enumerated,
	});
	if (aligned.kind === "over-budget") {
		return { kind: "refused", reason: "over-budget" };
	}
	const { alignment } = aligned;
	if (alignment === undefined || alignment.status !== "published") {
		if (alignment?.status === "conflict") {
			return { kind: "conflict", reason: "alignment-conflict" };
		}
		return { kind: "refused", reason: "unpublishable" };
	}

	return commitPublish(db, {
		alignment: alignment.alignment,
		anchorTitleId: input.anchorTitleId,
		continuity: input.continuity,
		discovered: input.discovered,
		enumeration: fetched.enumerated,
		groupId: input.groupId,
		revision: input.revision,
		target: input.mapping.member,
		targetOrdinal: input.mapping.ordinal,
		targetService: input.targetService,
		triedSource: highestTriedTier(aligned.ladder),
	});
};

const runSingleTargetPublish = async (
	db: Db,
	input: SingleTargetPublishInput,
): Promise<PublishResult> => {
	const budget = input.budget ?? DEFAULT_BUDGET;
	const revision = input.revision ?? DEFAULT_REVISION;
	const continuity = groupCoverageKey(input.group.groupId);

	await seedPendingCoverage(db, continuity, revision, input.targetService);

	const discovered = await discoverGroup({
		anchor: input.anchor,
		budget,
		clients: input.clients.discovery,
	});
	if (discovered.kind === "refused") {
		return { kind: "refused", reason: discovered.reason };
	}
	if (discovered.kind === "no-group") {
		return finishPublish(db, {
			continuity,
			groupId: input.group.groupId,
			revision,
			targetService: input.targetService,
		});
	}

	const mapping = targetMappingFor(discovered.discovered, input.targetService);
	if (mapping === undefined) {
		return finishPublish(db, {
			continuity,
			groupId: input.group.groupId,
			revision,
			targetService: input.targetService,
		});
	}

	return publishAlignedTarget(db, {
		anchorTitleId: input.group.requestedTitleId,
		budget,
		clients: input.clients,
		continuity,
		discovered: discovered.discovered,
		groupId: input.group.groupId,
		mapping,
		revision,
		targetService: input.targetService,
	});
};

export { DEFAULT_BUDGET, commitPublish, finishPublish, runSingleTargetPublish };
export type {
	PublishClients,
	PublishConflictReason,
	PublishRefusalReason,
	PublishResult,
	SingleTargetPublishInput,
};
