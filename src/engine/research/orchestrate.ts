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

// One continuity the pass investigates across every mapping service at once
// (ADR-0004) — never a single deterministic pair.
interface ResearchContinuity {
	readonly groupId: number;
	readonly id: string;
	readonly targetServices: readonly string[];
}

interface ResearchAgentResult {
	readonly proposals: readonly ResearchProposal[];
	// Services the pass could not resolve; the deterministic fan-out is the
	// fallback for this residue (ADR-0004).
	readonly residue: readonly string[];
}

// Injected LLM loop. Production wires the Vercel AI SDK against the decrypted
// provider config; tests mock the agent and the tools.
type ResearchAgent = (input: {
	readonly continuity: ResearchContinuity;
	readonly provider: ProviderConfig;
	readonly tools: ResearchToolset;
}) => Promisable<ResearchAgentResult>;

interface ResearchPassDeps {
	readonly agent: ResearchAgent;
	readonly clients: ResearchCatalogueClients;
	readonly db: Db;
	readonly masterKey: string;
	readonly providerId: string;
	// Optional override; default wires `reviewResearchProposal` with injected
	// judge/escalate so #61 stays the sole promotion path.
	readonly enqueueReview?: ReviewEnqueue;
	readonly review?: Pick<ReviewTaskDeps, "escalate" | "judge">;
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

const noopEnqueue: ReviewEnqueue = async () => {
	/* review optional when caller only asserts publish shape */
};

const defaultEnqueue = (
	deps: Pick<ResearchPassDeps, "db" | "review">,
): ReviewEnqueue => {
	const { review } = deps;
	if (review === undefined) {
		return noopEnqueue;
	}
	return async (proposal) =>
		reviewResearchProposal(proposal, {
			db: deps.db,
			escalate: review.escalate,
			judge: review.judge,
		});
};

// Agentic research pass for one continuity. Honours the timing policy, loads
// the configured provider from the encrypted store, runs tools that persist
// validated spokes, publishes through the corroboration gate, and leaves
// unresolved services as deterministic residue.
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
	const enqueue = deps.enqueueReview ?? defaultEnqueue(deps);
	const published = await publishResearchProposals(
		deps.db,
		agentResult.proposals,
		enqueue,
	);

	return {
		kind: "completed",
		published,
		residue: agentResult.residue,
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
