import type { Promisable } from "type-fest";

import { discover } from "@/engine/discovery";
import type { ColdLookup } from "@/engine/gateway";
import { toGraphMember } from "@/engine/gateway/keys.ts";
import type {
	Identity,
	Profile,
	Service,
	TitleIdentity,
} from "@/engine/identity.ts";
import {
	defaultOverflowBudget,
	estimateBuild,
	groupCoverageKey,
	overflowInstanceId,
	seedPendingCoverage,
} from "@/engine/overflow";
import type { ColdEstimate, OverflowBudget } from "@/engine/overflow";
import { writeCoverageState } from "@/engine/overflow/coverage.ts";

import { bootstrapFromIdentity } from "./bootstrap.ts";
import type { BootstrappedGroup } from "./bootstrap.ts";
import type { IngestEnv } from "./env.ts";
import { targetPlansFor } from "./plannable.ts";
import type { TargetPlan } from "./plannable.ts";
import { probeUpstream } from "./probe.ts";
import { runAtomicTargetPublish, runSingleTargetPublish } from "./publish.ts";
import type { PublishResult } from "./publish.ts";

const BASELINE_REVISION = 1;

interface LiveColdLookupInput {
	readonly budget?: OverflowBudget;
	readonly resolveIngest: () => Promisable<IngestEnv>;
}

interface InlinePublishInput {
	readonly anchor: TitleIdentity;
	readonly budget: OverflowBudget;
	readonly continuity: ReturnType<typeof groupCoverageKey>;
	readonly discovery: NonNullable<IngestEnv["structuralDiscovery"]>;
	readonly group: BootstrappedGroup;
	readonly ingest: IngestEnv;
	readonly target: TargetPlan;
}

interface LiveIngestInput extends InlinePublishInput {
	readonly profile: Profile;
}

interface EstimateIngestWorkInput {
	readonly group: BootstrappedGroup;
	readonly ingest: IngestEnv;
	readonly targetService: Service;
	readonly title: TitleIdentity;
}

interface IngestWorkCounts {
	readonly chainSegments: number;
	readonly targetCandidates: number;
}

const upstreamExists = async (input: {
	readonly ingest: IngestEnv;
	readonly title: TitleIdentity;
}): Promise<boolean> => {
	const probe = await probeUpstream(input.title, {
		catalogues: input.ingest.catalogue.verification,
		...(input.ingest.catalogue.simkl === undefined
			? {}
			: { simkl: input.ingest.catalogue.simkl }),
	});
	return probe.kind === "confirmed";
};

const ingestWorkEstimate = (
	builds: ColdEstimate["builds"],
	counts: IngestWorkCounts,
): ColdEstimate => ({
	builds,
	input: {
		...counts,
		targetServices: builds.length,
	},
});

const estimateIngestWork = async (
	input: EstimateIngestWorkInput,
): Promise<ColdEstimate> => {
	const builds = [
		{
			baselineRevision: BASELINE_REVISION,
			continuity: input.group.baselineContinuity,
			targetService: input.targetService,
		},
	];
	const brokered = await discover(
		{
			cursor: {
				id: input.title.id,
				service: input.title.service,
			},
			target: input.targetService,
		},
		input.ingest.catalogue.simkl === undefined
			? {}
			: { simkl: input.ingest.catalogue.simkl },
	);
	if (brokered.kind === "brokered") {
		return ingestWorkEstimate(builds, {
			chainSegments: brokered.chain.segments.length,
			targetCandidates: brokered.candidates.length,
		});
	}
	const candidates = await input.ingest.structuralDiscovery?.find.find(
		toGraphMember(input.title),
	);
	return ingestWorkEstimate(builds, {
		chainSegments: 1,
		targetCandidates:
			candidates?.filter(
				(candidate) => candidate.service === input.targetService,
			).length ?? 0,
	});
};

const publishInline = async (
	input: InlinePublishInput,
): Promise<PublishResult | undefined> => {
	const publish =
		input.target.kind === "atomic"
			? runAtomicTargetPublish
			: runSingleTargetPublish;
	return publish(input.ingest.db, {
		anchor: input.anchor,
		budget: input.budget.requestBudget,
		clients: { discovery: input.discovery },
		group: input.group,
		targetService: input.target.service,
	});
};

const dispatchOverflow = async (input: {
	readonly dispatcher: IngestEnv["dispatcher"];
	readonly identity: Identity;
	readonly profile: Profile;
	readonly work: ColdEstimate;
}): Promise<void> => {
	await Promise.all(
		input.work.builds.map(async (work) => {
			await input.dispatcher?.ensure(overflowInstanceId(work), {
				identity: input.identity,
				profile: input.profile,
				work,
			});
		}),
	);
};

const settleInlinePublish = async (
	input: InlinePublishInput,
): Promise<void> => {
	const result = await publishInline(input);
	if (result?.kind === "refused" && result.reason !== "unavailable-target") {
		await writeCoverageState(
			input.ingest.db,
			input.continuity,
			BASELINE_REVISION,
			input.target.service,
			"conflict",
		);
	}
};

const seedPendingTargets = async (
	db: IngestEnv["db"],
	continuity: ReturnType<typeof groupCoverageKey>,
	targets: readonly TargetPlan[],
): Promise<void> => {
	await Promise.all(
		targets.map(async (target) =>
			seedPendingCoverage(db, continuity, BASELINE_REVISION, target.service),
		),
	);
};

const executeIngestWork = async (input: LiveIngestInput): Promise<void> => {
	try {
		const work = await estimateIngestWork({
			group: input.group,
			ingest: input.ingest,
			targetService: input.target.service,
			title: input.anchor,
		});
		if (!estimateBuild(work.input, input.budget).fitsBudget) {
			await dispatchOverflow({
				dispatcher: input.ingest.dispatcher,
				identity: { kind: "title", title: input.anchor },
				profile: input.profile,
				work,
			});
			return;
		}
		await settleInlinePublish(input);
	} catch (error) {
		await writeCoverageState(
			input.ingest.db,
			input.continuity,
			BASELINE_REVISION,
			input.target.service,
			"conflict",
		);
		throw error;
	}
};

const settleInlineTargets = async (input: {
	readonly budget: OverflowBudget;
	readonly continuity: ReturnType<typeof groupCoverageKey>;
	readonly discovery: NonNullable<IngestEnv["structuralDiscovery"]>;
	readonly group: BootstrappedGroup;
	readonly ingest: IngestEnv;
	readonly profile: Profile;
	readonly title: TitleIdentity;
	readonly targets: readonly TargetPlan[];
}): Promise<void> => {
	await Promise.all(
		input.targets.map(async (target) =>
			executeIngestWork({
				anchor: input.title,
				budget: input.budget,
				continuity: input.continuity,
				discovery: input.discovery,
				group: input.group,
				ingest: input.ingest,
				profile: input.profile,
				target,
			}),
		),
	);
};

const createLiveColdLookup = (input: LiveColdLookupInput): ColdLookup => {
	const budget = input.budget ?? defaultOverflowBudget;

	return {
		begin: async (identity, profile) => {
			const targets = targetPlansFor(identity, profile);
			if (targets.length === 0 || identity.kind !== "title") {
				return { kind: "miss" };
			}
			const ingest = await input.resolveIngest();
			if (
				!(await upstreamExists({
					ingest,
					title: identity.title,
				}))
			) {
				return { kind: "miss" };
			}
			const bootstrap = await bootstrapFromIdentity(ingest.db, identity);
			if (bootstrap.kind !== "bootstrapped") {
				return { kind: "miss" };
			}
			const continuity = groupCoverageKey(bootstrap.group.groupId);
			const discovery = ingest.structuralDiscovery;
			await seedPendingTargets(ingest.db, continuity, targets);
			if (discovery === undefined) {
				return { kind: "updated" };
			}
			await settleInlineTargets({
				budget,
				continuity,
				discovery,
				group: bootstrap.group,
				ingest,
				profile,
				targets,
				title: identity.title,
			});
			return { kind: "updated" };
		},
	};
};

export { createLiveColdLookup, estimateIngestWork };
export type { EstimateIngestWorkInput, LiveColdLookupInput };
