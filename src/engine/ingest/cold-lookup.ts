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
	seedPendingCoverage,
} from "@/engine/overflow";
import type { OverflowBudget } from "@/engine/overflow";
import { writeCoverageState } from "@/engine/overflow/coverage.ts";

import { bootstrapFromIdentity } from "./bootstrap.ts";
import type { BootstrappedGroup } from "./bootstrap.ts";
import type { IngestEnv } from "./env.ts";
import { probeUpstream } from "./probe.ts";
import { runAtomicTargetPublish } from "./publish.ts";
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
	readonly targetService: Service;
}

const movieTargetService = (
	identity: Identity,
	profile: Profile,
): Service | undefined => {
	if (profile !== "movie" || identity.kind !== "title") {
		return undefined;
	}
	if (identity.title.service === "tmdb") {
		return "imdb";
	}
	if (identity.title.service === "imdb") {
		return "tmdb";
	}
	return undefined;
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
}): Promise<boolean> => {
	const candidates = await input.discovery.find.find(
		toGraphMember(input.title),
	);
	return estimateBuild(
		{
			chainSegments: 1,
			targetCandidates: candidates.length,
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
			title: input.anchor,
		}))
	) {
		return;
	}
	return runAtomicTargetPublish(input.ingest.db, {
		anchor: input.anchor,
		budget: input.budget.requestBudget,
		clients: { discovery: input.discovery },
		group: input.group,
		targetService: input.targetService,
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
				input.targetService,
				"conflict",
			);
		}
	} catch (error) {
		await writeCoverageState(
			input.ingest.db,
			input.continuity,
			BASELINE_REVISION,
			input.targetService,
			"conflict",
		);
		throw error;
	}
};

const createLiveColdLookup = (input: LiveColdLookupInput): ColdLookup => {
	const budget = input.budget ?? defaultOverflowBudget;

	return {
		begin: async (identity, profile) => {
			const targetService = movieTargetService(identity, profile);
			if (targetService === undefined || identity.kind !== "title") {
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
			await seedPendingCoverage(
				ingest.db,
				continuity,
				BASELINE_REVISION,
				targetService,
			);
			const discovery = ingest.structuralDiscovery;
			if (discovery === undefined) {
				return { kind: "updated" };
			}
			await settleInlinePublish({
				anchor: identity.title,
				budget,
				continuity,
				discovery,
				group: bootstrap.group,
				ingest,
				targetService,
			});
			return { kind: "updated" };
		},
	};
};

export { createLiveColdLookup };
export type { LiveColdLookupInput };
