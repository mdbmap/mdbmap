import { and, eq } from "drizzle-orm";

import { serviceCoverages } from "@/db/engine-schema";
import type { ColdLookup, PendingBuild } from "@/engine/gateway";
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

import { bootstrapFromIdentity } from "./bootstrap.ts";
import type { BootstrappedGroup } from "./bootstrap.ts";
import type { IngestEnv } from "./env.ts";
import { probeUpstream } from "./probe.ts";
import { runAtomicTargetPublish } from "./publish.ts";

const BASELINE_REVISION = 1;
const DEFAULT_RETRY_AFTER_SECONDS = 5;

interface LiveColdLookupInput {
	readonly budget?: OverflowBudget;
	readonly ingest: IngestEnv;
	readonly retryAfterSeconds?: number;
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

const pendingBuild = (
	coverageRowId: number,
	retryAfterSeconds: number,
): PendingBuild => ({
	retryAfterSeconds,
	statusUrl: `/api/engine/status/pending:${coverageRowId}`,
});

const seedPendingBuild = async (input: {
	readonly group: BootstrappedGroup;
	readonly ingest: IngestEnv;
	readonly retryAfterSeconds: number;
	readonly targetService: Service;
}): Promise<PendingBuild> => {
	const continuity = groupCoverageKey(input.group.groupId);
	await seedPendingCoverage(
		input.ingest.db,
		continuity,
		BASELINE_REVISION,
		input.targetService,
	);
	const row = await input.ingest.db
		.select({ id: serviceCoverages.id })
		.from(serviceCoverages)
		.where(
			and(
				eq(serviceCoverages.baselineContinuity, continuity),
				eq(serviceCoverages.revision, BASELINE_REVISION),
				eq(serviceCoverages.targetService, input.targetService),
			),
		)
		.get();
	if (row === undefined) {
		throw new Error("pending coverage missing after seed");
	}
	return pendingBuild(row.id, input.retryAfterSeconds);
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
	readonly targetService: Service;
	readonly title: TitleIdentity;
}): Promise<boolean> => {
	const candidates = await input.discovery.find.find(
		toGraphMember(input.title),
	);
	return estimateBuild(
		{
			chainSegments: 1,
			targetCandidates: candidates.filter(
				(candidate) => candidate.service === input.targetService,
			).length,
			targetServices: 1,
		},
		input.budget,
	).fitsBudget;
};

const publishInline = async (input: {
	readonly anchor: TitleIdentity;
	readonly budget: OverflowBudget;
	readonly discovery: NonNullable<IngestEnv["structuralDiscovery"]>;
	readonly group: BootstrappedGroup;
	readonly ingest: IngestEnv;
	readonly targetService: Service;
}): Promise<void> => {
	if (
		!(await fitsInline({
			budget: input.budget,
			discovery: input.discovery,
			targetService: input.targetService,
			title: input.anchor,
		}))
	) {
		return;
	}
	await runAtomicTargetPublish(input.ingest.db, {
		anchor: input.anchor,
		clients: { discovery: input.discovery },
		group: input.group,
		targetService: input.targetService,
	});
};

const createLiveColdLookup = (input: LiveColdLookupInput): ColdLookup => {
	const budget = input.budget ?? defaultOverflowBudget;
	const retryAfterSeconds =
		input.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;

	return {
		begin: async (identity, profile) => {
			const targetService = movieTargetService(identity, profile);
			if (targetService === undefined || identity.kind !== "title") {
				return { kind: "miss" };
			}
			if (
				!(await upstreamExists({
					ingest: input.ingest,
					title: identity.title,
				}))
			) {
				return { kind: "miss" };
			}
			const bootstrap = await bootstrapFromIdentity(input.ingest.db, identity);
			if (bootstrap.kind !== "bootstrapped") {
				return { kind: "miss" };
			}
			const build = await seedPendingBuild({
				group: bootstrap.group,
				ingest: input.ingest,
				retryAfterSeconds,
				targetService,
			});
			const discovery = input.ingest.structuralDiscovery;
			if (discovery === undefined) {
				return { build, kind: "started" };
			}
			try {
				await publishInline({
					anchor: identity.title,
					budget,
					discovery,
					group: bootstrap.group,
					ingest: input.ingest,
					targetService,
				});
			} catch {
				return { build, kind: "started" };
			}
			return { build, kind: "started" };
		},
	};
};

export { createLiveColdLookup };
export type { LiveColdLookupInput };
