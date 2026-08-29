import type { Db } from "@/db";
import { retireBootstrapScaffoldingForGroup } from "@/engine/ingest/bootstrap.ts";
import { createBudget } from "@/engine/matcher";
import type { BudgetSnapshot, TierId } from "@/engine/matcher";
import { recomputeGroup } from "@/engine/recompute/recompute.ts";
import type {
	FreshPairing,
	RecomputeOutcome,
} from "@/engine/recompute/recompute.ts";
import { sampleResearchRecheck } from "@/engine/research/recheck.ts";
import type { ResearchRecheckOutcome } from "@/engine/research/recheck.ts";
import type { ResearchCatalogueClients } from "@/engine/research/tools.ts";

interface RevalidateGroupInput {
	readonly budgetLimit: number;
	readonly clients: ResearchCatalogueClients;
	readonly groupId: number;
	readonly ladderComplete: boolean;
	readonly pairings: readonly FreshPairing[];
	readonly triedSource: TierId;
}

type RevalidateGroupOutcome =
	| {
			readonly kind: "applied";
			readonly members: number;
			readonly recheck: ResearchRecheckOutcome;
			readonly recompute: Extract<RecomputeOutcome, { kind: "applied" }>;
			readonly budget: BudgetSnapshot;
	  }
	| {
			readonly kind: "recompute-blocked";
			readonly outcome: Exclude<RecomputeOutcome, { kind: "applied" }>;
	  };

const revalidateGroup = async (
	db: Db,
	input: RevalidateGroupInput,
): Promise<RevalidateGroupOutcome> => {
	const budget = createBudget(input.budgetLimit);

	const recompute = await recomputeGroup(db, {
		groupId: input.groupId,
		ladderComplete: input.ladderComplete,
		pairings: input.pairings,
		triedSource: input.triedSource,
	});

	if (recompute.kind !== "applied") {
		return { kind: "recompute-blocked", outcome: recompute };
	}

	await retireBootstrapScaffoldingForGroup(db, input.groupId);

	const recheck = await sampleResearchRecheck(db, {
		budget,
		clients: input.clients,
		groupId: input.groupId,
	});

	return {
		budget: budget.snapshot(),
		kind: "applied",
		members: recompute.plan.precondition.memberTitleIds.length,
		recheck,
		recompute,
	};
};

export { revalidateGroup };
export type { RevalidateGroupInput, RevalidateGroupOutcome };
