import { eq, inArray } from "drizzle-orm";
import type { Promisable } from "type-fest";

import type { Db } from "@/db";
import { serviceInstalments, serviceTitles } from "@/db/engine-schema";
import type { SimklClient } from "@/engine/discovery";
import type { ProviderConfig } from "@/lib/provider-config";
import { getProviderConfig } from "@/lib/provider-config";

import { publishResearchProposals } from "./publish.ts";
import type { ResearchProposal, ReviewEnqueue } from "./publish.ts";
import { shouldRunResearch } from "./timing.ts";
import type {
	ResearchPhase,
	ResearchTimingStore,
} from "./timing.ts";
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
	readonly providerId: string;
	readonly scrape?: ScrapeClient;
	readonly simkl?: SimklClient;
	readonly timing: ResearchTimingStore;
}

type ResearchPassOutcome =
	| {
			readonly kind: "completed";
			readonly published: Awaited<
				ReturnType<typeof publishResearchProposals>
			>;
			readonly residue: readonly string[];
	  }
	| {
			readonly kind: "skipped";
			readonly reason: "timing-mismatch" | "timing-off";
			readonly residue: readonly string[];
	  };

const servicesFromProposals = async (
	db: Db,
	proposals: readonly ResearchProposal[],
): Promise<ReadonlySet<string>> => {
	const services = new Set<string>();
	const instalmentIds: number[] = [];
	for (const proposal of proposals) {
		switch (proposal.kind) {
			case "title": {
				services.add(proposal.left.service);
				services.add(proposal.right.service);
				break;
			}
			case "relation": {
				services.add(proposal.from.service);
				services.add(proposal.to.service);
				break;
			}
			case "instalment": {
				instalmentIds.push(proposal.instalmentId);
				break;
			}
		}
	}
	if (instalmentIds.length > 0) {
		const owners = await db
			.select({ service: serviceTitles.service })
			.from(serviceInstalments)
			.innerJoin(
				serviceTitles,
				eq(serviceInstalments.titleId, serviceTitles.id),
			)
			.where(inArray(serviceInstalments.id, instalmentIds))
			.all();
		for (const owner of owners) {
			services.add(owner.service);
		}
	}
	return services;
};

const mergeResidue = async (
	db: Db,
	targetServices: readonly string[],
	agentResidue: readonly string[],
	proposals: readonly ResearchProposal[],
): Promise<readonly string[]> => {
	const accounted = new Set([
		...agentResidue,
		...(await servicesFromProposals(db, proposals)),
	]);
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

const runResearchPass = async (
	continuity: ResearchContinuity,
	phase: ResearchPhase,
	deps: ResearchPassDeps,
): Promise<ResearchPassOutcome> => {
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

	const provider = await getProviderConfig(
		deps.db,
		deps.masterKey,
		deps.providerId,
	);
	const tools = buildResearchTools({
		clients: deps.clients,
		db: deps.db,
		groupId: continuity.groupId,
		...(deps.scrape === undefined ? {} : { scrape: deps.scrape }),
		...(deps.simkl === undefined ? {} : { simkl: deps.simkl }),
	});

	const agentResult = await deps.agent({ continuity, provider, tools });
	const published = await publishResearchProposals(
		deps.db,
		agentResult.proposals,
		deps.enqueueReview,
	);

	return {
		kind: "completed",
		published,
		residue: await mergeResidue(
			deps.db,
			continuity.targetServices,
			agentResult.residue,
			agentResult.proposals,
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
