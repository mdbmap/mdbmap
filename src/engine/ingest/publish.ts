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
	writeCoverageState,
	seedPendingCoverage,
} from "@/engine/overflow/coverage.ts";
import { recomputeGroup } from "@/engine/recompute/recompute.ts";
import type { FreshPairing } from "@/engine/recompute/recompute.ts";

import { queueAlignmentCrossingConflicts } from "./alignment-conflict.ts";
import type { BootstrappedGroup } from "./bootstrap.ts";
import { retireBootstrapScaffoldingForGroup } from "./bootstrap.ts";
import {
	alignmentFromMappedPairs,
	alignTarget,
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
	readonly sharedEnumeration?: EnumeratedTitle;
	readonly revision: number;
	readonly target: ServiceRef;
	readonly targetOrdinal: number;
	readonly targetService: Service;
	readonly triedSource: FreshPairing["source"];
}

const endPublishAttempt = async (
	db: Db,
	input: {
		readonly continuity: ReturnType<typeof groupCoverageKey>;
		readonly revision: number;
		readonly targetService: Service;
	},
	result: PublishResult,
): Promise<PublishResult> => {
	if (result.kind === "conflict") {
		await writeCoverageState(
			db,
			input.continuity,
			input.revision,
			input.targetService,
			"conflict",
		);
	}
	return result;
};

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
	if (input.sharedEnumeration !== undefined) {
		await ensureSpokes(db, input.anchorTitleId, input.sharedEnumeration);
	}
	await ensureSpokes(db, targetTitleId, input.enumeration);

	const converge = await convergeGroups(db, {
		members: convergeMembersOf(input.discovered),
	});
	if (converge.kind === "candidate") {
		return endPublishAttempt(db, input, {
			kind: "conflict",
			reason: "converge-candidate",
		});
	}
	if (converge.kind === "aborted") {
		return endPublishAttempt(db, input, {
			kind: "refused",
			reason: "unpublishable",
		});
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
		return endPublishAttempt(db, input, {
			kind: "refused",
			reason: "unpublishable",
		});
	}
	await retireBootstrapScaffoldingForGroup(db, input.groupId);

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
		return endPublishAttempt(db, input, {
			kind: "refused",
			reason: "unavailable-target",
		});
	}

	const sharedFetched = await fetchTargetStream({
		clients: input.clients.discovery,
		target: input.discovered.shared,
	});
	if (sharedFetched.kind !== "fetched") {
		return endPublishAttempt(db, input, {
			kind: "refused",
			reason: "unavailable-target",
		});
	}
	const anchorStream = sharedFetched.enumerated.stream;

	if (input.mapping.pairs.length > 0) {
		return commitPublish(db, {
			alignment: alignmentFromMappedPairs(
				anchorStream,
				fetched.enumerated.stream,
				input.mapping.pairs,
			),
			anchorTitleId: input.anchorTitleId,
			continuity: input.continuity,
			discovered: input.discovered,
			enumeration: fetched.enumerated,
			groupId: input.groupId,
			revision: input.revision,
			sharedEnumeration: sharedFetched.enumerated,
			target: input.mapping.member,
			targetOrdinal: input.mapping.ordinal,
			targetService: input.targetService,
			triedSource: "t3-episode",
		});
	}

	const aligned = alignTarget({
		anchor: anchorStream,
		...(sharedFetched.kind === "fetched"
			? { anchorFacts: sharedFetched.enumerated.facts }
			: {}),
		budget: input.budget,
		target: fetched.enumerated,
	});
	if (aligned.kind === "over-budget") {
		return endPublishAttempt(db, input, {
			kind: "refused",
			reason: "over-budget",
		});
	}
	const { alignment } = aligned;
	if (alignment === undefined || alignment.status !== "published") {
		if (alignment?.status === "conflict") {
			const targetTitleId = await ensureTitle(
				db,
				input.groupId,
				input.mapping.member,
				input.mapping.ordinal,
			);
			if (sharedFetched.kind === "fetched") {
				await ensureSpokes(db, input.anchorTitleId, sharedFetched.enumerated);
			}
			await ensureSpokes(db, targetTitleId, fetched.enumerated);
			await queueAlignmentCrossingConflicts(db, {
				anchorTitleId: input.anchorTitleId,
				crossings: alignment.crossings,
				evidenceHashPrefix: "publish-alignment-conflict",
				targetTitleId,
				triedSource: highestTriedTier(aligned.ladder),
			});
			return endPublishAttempt(db, input, {
				kind: "conflict",
				reason: "alignment-conflict",
			});
		}
		return endPublishAttempt(db, input, {
			kind: "refused",
			reason: "unpublishable",
		});
	}

	return commitPublish(db, {
		alignment: alignment.alignment,
		anchorTitleId: input.anchorTitleId,
		continuity: input.continuity,
		discovered: input.discovered,
		enumeration: fetched.enumerated,
		groupId: input.groupId,
		revision: input.revision,
		sharedEnumeration: sharedFetched.enumerated,
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
		return endPublishAttempt(
			db,
			{ continuity, revision, targetService: input.targetService },
			{ kind: "refused", reason: discovered.reason },
		);
	}
	if (discovered.kind === "no-group") {
		return endPublishAttempt(
			db,
			{ continuity, revision, targetService: input.targetService },
			{ kind: "refused", reason: "unavailable-target" },
		);
	}

	const mapping = targetMappingFor(discovered.discovered, input.targetService);
	if (mapping === undefined) {
		return endPublishAttempt(
			db,
			{ continuity, revision, targetService: input.targetService },
			{ kind: "refused", reason: "unavailable-target" },
		);
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
