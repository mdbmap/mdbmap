import type { Promisable } from "type-fest";

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
} from "@/engine/overflow";
import type { OverflowBudget } from "@/engine/overflow";
import { writeCoverageState } from "@/engine/overflow/coverage.ts";

import { bootstrapFromIdentity } from "./bootstrap.ts";
import type { BootstrappedGroup } from "./bootstrap.ts";
import type { IngestEnv } from "./env.ts";
import { probeUpstream } from "./probe.ts";
import { runAtomicTargetPublish, runSingleTargetPublish } from "./publish.ts";
import type { PublishResult } from "./publish.ts";

const BASELINE_REVISION = 1;

interface LiveColdLookupInput {
	readonly budget?: OverflowBudget;
	readonly resolveIngest: () => Promisable<IngestEnv>;
}

type TargetPlan =
	| { readonly kind: "atomic"; readonly service: Service }
	| { readonly kind: "enumerated"; readonly service: Service };

interface InlinePublishInput {
	readonly anchor: TitleIdentity;
	readonly budget: OverflowBudget;
	readonly continuity: ReturnType<typeof groupCoverageKey>;
	readonly discovery: NonNullable<IngestEnv["structuralDiscovery"]>;
	readonly group: BootstrappedGroup;
	readonly ingest: IngestEnv;
	readonly target: TargetPlan;
}

const targetPlansFor = (
	identity: Identity,
	profile: Profile,
): readonly TargetPlan[] => {
	if (identity.kind !== "title") {
		return [];
	}
	if (profile === "anime") {
		return (["anilist", "mal"] as const)
			.filter((service) => service !== identity.title.service)
			.map((service) => ({ kind: "enumerated", service }));
	}
	if (identity.title.service === "tmdb") {
		return [{ kind: "atomic", service: "imdb" }];
	}
	if (identity.title.service === "imdb") {
		return [{ kind: "atomic", service: "tmdb" }];
	}
	return [];
};

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

const fitsInline = async (input: {
	readonly budget: OverflowBudget;
	readonly discovery: NonNullable<IngestEnv["structuralDiscovery"]>;
	readonly title: TitleIdentity;
	readonly target: TargetPlan;
}): Promise<boolean> => {
	const candidates = await input.discovery.find.find(
		toGraphMember(input.title),
	);
	return estimateBuild(
		{
			chainSegments: 1,
			targetCandidates: candidates.filter(
				(candidate) => candidate.service === input.target.service,
			).length,
			targetServices: 1,
		},
		input.budget,
	).fitsBudget;
};

const publishInline = async (
	input: InlinePublishInput,
): Promise<PublishResult | undefined> => {
	if (
		!(await fitsInline({
			budget: input.budget,
			discovery: input.discovery,
			target: input.target,
			title: input.anchor,
		}))
	) {
		return;
	}
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

const settleInlinePublish = async (
	input: InlinePublishInput,
): Promise<void> => {
	try {
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

const settleInlineTargets = async (input: {
	readonly budget: OverflowBudget;
	readonly continuity: ReturnType<typeof groupCoverageKey>;
	readonly discovery: NonNullable<IngestEnv["structuralDiscovery"]>;
	readonly group: BootstrappedGroup;
	readonly ingest: IngestEnv;
	readonly title: TitleIdentity;
	readonly targets: readonly TargetPlan[];
}): Promise<void> => {
	await Promise.all(
		input.targets.map(async (target) =>
			settleInlinePublish({
				anchor: input.title,
				budget: input.budget,
				continuity: input.continuity,
				discovery: input.discovery,
				group: input.group,
				ingest: input.ingest,
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
				targets,
				title: identity.title,
			});
			return { kind: "updated" };
		},
	};
};

export { createLiveColdLookup };
export type { LiveColdLookupInput };
