import type { Promisable } from "type-fest";

import type { Db } from "@/db";
import type { SimklClient } from "@/engine/discovery";
import type { ReviewTaskDeps } from "@/engine/reviewer";
import { reviewResearchProposal } from "@/engine/reviewer";
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

type ResearchJudgeDeps = Pick<ReviewTaskDeps, "escalate" | "judge">;

type ResearchReviewWiring =
	| {
			readonly enqueueReview: ReviewEnqueue;
			readonly review?: ResearchJudgeDeps;
	  }
	| {
			readonly enqueueReview?: undefined;
			readonly review: ResearchJudgeDeps;
	  };

type ResearchPassDeps = {
	readonly agent: ResearchAgent;
	readonly clients: ResearchCatalogueClients;
	readonly db: Db;
	readonly masterKey: string;
	readonly providerId: string;
	readonly scrape?: ScrapeClient;
	readonly simkl?: SimklClient;
	readonly timing: ResearchTimingStore;
} & ResearchReviewWiring;

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

const resolveEnqueue = (deps: ResearchPassDeps): ReviewEnqueue => {
	if (deps.enqueueReview !== undefined) {
		return deps.enqueueReview;
	}
	const { review } = deps;
	return async (proposal) =>
		reviewResearchProposal(proposal, {
			db: deps.db,
			escalate: review.escalate,
			judge: review.judge,
		});
};

const servicesFromProposals = (
	proposals: readonly ResearchProposal[],
): ReadonlySet<string> => {
	const services = new Set<string>();
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
				for (const item of proposal.evidence) {
					if (item.kind === "api" || item.kind === "scrape") {
						services.add(item.operator);
					}
				}
				break;
			}
		}
	}
	return services;
};

const mergeResidue = (
	targetServices: readonly string[],
	agentResidue: readonly string[],
	proposals: readonly ResearchProposal[],
): readonly string[] => {
	const accounted = new Set([
		...agentResidue,
		...servicesFromProposals(proposals),
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
		resolveEnqueue(deps),
	);

	return {
		kind: "completed",
		published,
		residue: mergeResidue(
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
