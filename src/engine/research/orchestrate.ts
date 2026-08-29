import type { Promisable } from "type-fest";

import type { Db } from "@/db";
import type { SimklClient } from "@/engine/discovery";
import type { ProviderConfig } from "@/lib/provider-config";
import { getProviderConfig, listProviders } from "@/lib/provider-config";

import { publishResearchProposals } from "./publish.ts";
import type { ResearchProposal, ReviewEnqueue } from "./publish.ts";
import { resolveResearchSchedule } from "./schedule.ts";
import { shouldRunResearch } from "./timing.ts";
import type { ResearchPhase, ResearchTimingStore } from "./timing.ts";
import { buildResearchTools } from "./tools.ts";
import type {
	ResearchCatalogueClients,
	ResearchToolset,
	ScrapeClient,
} from "./tools.ts";

interface ResearchContinuity {
	readonly groupId: number;
	readonly id: string;
	readonly targetServices: readonly string[];
}

interface ResearchAgentResult {
	readonly proposals: readonly ResearchProposal[];
	readonly residue: readonly string[];
}

type ResearchAgent = (input: {
	readonly continuity: ResearchContinuity;
	readonly provider: ProviderConfig;
	readonly tools: ResearchToolset;
}) => Promisable<ResearchAgentResult>;

interface ResearchPassDeps {
	readonly agent: ResearchAgent;
	readonly clients: ResearchCatalogueClients;
	readonly db: Db;
	readonly enqueueReview: ReviewEnqueue;
	readonly masterKey: string;
	readonly providerId?: string;
	readonly scrape?: ScrapeClient;
	readonly simkl?: SimklClient;
	readonly timing?: ResearchTimingStore;
}

type ResearchPassOutcome =
	| {
			readonly kind: "completed";
			readonly published: Awaited<
				ReturnType<typeof publishResearchProposals>
			>["published"];
			readonly residue: readonly string[];
	  }
	| {
			readonly kind: "skipped";
			readonly reason: "no-provider" | "timing-mismatch" | "timing-off";
			readonly residue: readonly string[];
	  };

const mergeResidue = (
	targetServices: readonly string[],
	agentResidue: readonly string[],
	resolvedServices: ReadonlySet<string>,
): readonly string[] => {
	const accounted = new Set([...agentResidue, ...resolvedServices]);
	const skipped = targetServices.filter((service) => !accounted.has(service));
	const seen = new Set<string>();
	const merged: string[] = [];
	for (const service of [...agentResidue, ...skipped]) {
		if (seen.has(service)) {
			continue;
		}
		seen.add(service);
		merged.push(service);
	}
	return merged;
};

const resolveProviderId = async (
	deps: Pick<ResearchPassDeps, "db" | "masterKey" | "providerId">,
): Promise<string | undefined> => {
	if (deps.providerId !== undefined) {
		return deps.providerId;
	}
	const providers = await listProviders(deps.db, deps.masterKey);
	return providers[0]?.id;
};

const runResearchPass = async (
	continuity: ResearchContinuity,
	phase: ResearchPhase,
	deps: ResearchPassDeps,
): Promise<ResearchPassOutcome> => {
	if (deps.timing === undefined) {
		const schedule = await resolveResearchSchedule(deps.db);
		if (!schedule.run) {
			return {
				kind: "skipped",
				reason: "timing-off",
				residue: continuity.targetServices,
			};
		}
		if (schedule.when !== phase) {
			return {
				kind: "skipped",
				reason: "timing-mismatch",
				residue: continuity.targetServices,
			};
		}
	} else {
		const timing = await deps.timing.read();
		if (timing === "off") {
			return {
				kind: "skipped",
				reason: "timing-off",
				residue: continuity.targetServices,
			};
		}
		if (!shouldRunResearch(timing, phase)) {
			return {
				kind: "skipped",
				reason: "timing-mismatch",
				residue: continuity.targetServices,
			};
		}
	}

	const providerId = await resolveProviderId(deps);
	if (providerId === undefined) {
		return {
			kind: "skipped",
			reason: "no-provider",
			residue: continuity.targetServices,
		};
	}

	const provider = await getProviderConfig(deps.db, deps.masterKey, providerId);
	const tools = buildResearchTools({
		clients: deps.clients,
		db: deps.db,
		groupId: continuity.groupId,
		...(deps.scrape === undefined ? {} : { scrape: deps.scrape }),
		...(deps.simkl === undefined ? {} : { simkl: deps.simkl }),
	});

	const agentResult = await (async (): Promise<ResearchAgentResult> => {
		try {
			return await deps.agent({ continuity, provider, tools });
		} catch {
			return { proposals: [], residue: continuity.targetServices };
		}
	})();
	const { published, resolvedServices } = await publishResearchProposals(
		deps.db,
		agentResult.proposals,
		deps.enqueueReview,
	);

	return {
		kind: "completed",
		published,
		residue: mergeResidue(
			continuity.targetServices,
			agentResult.residue,
			resolvedServices,
		),
	};
};

export { runResearchPass };
export type {
	ResearchAgent,
	ResearchAgentResult,
	ResearchContinuity,
	ResearchPassDeps,
	ResearchPassOutcome,
};
