import type { BudgetLedger, BudgetSnapshot } from "./budget.ts";
import type { AlignmentOutcome, TierLink } from "./framework.ts";
import { alignStreams } from "./framework.ts";
import type { InstalmentStream } from "./instalment.ts";
import type { CandidatePairing, MatchingOrder } from "./monotonic.ts";
import { indexStream } from "./monotonic.ts";

const tierIds = ["t1-structure", "t2-pattern", "t3-episode"] as const;
type TierId = (typeof tierIds)[number];

interface TierContext {
	readonly budget: BudgetLedger;
	readonly left: InstalmentStream;
	readonly order: MatchingOrder;
	readonly placed: readonly CandidatePairing[];
	readonly right: InstalmentStream;
}

type TierProposal =
	| { readonly kind: "over-budget" }
	| {
			readonly kind: "proposed";
			readonly links: readonly TierLink[];
			readonly order?: MatchingOrder;
	  };

// A tier reads the streams and what earlier rungs already placed, spends against
// the shared budget, and proposes candidate pairings. Scoring lives in the tier
// implementations; the framework only validates and assembles.
interface Tier {
	readonly id: TierId;
	readonly propose: (context: TierContext) => TierProposal;
}

interface LadderTiers {
	readonly t1: Tier;
	readonly t2: Tier;
	readonly t3: Tier;
}

interface TierContribution {
	readonly proposal: TierProposal;
	readonly tier: TierId;
}

interface LadderInput {
	readonly budget: BudgetLedger;
	readonly left: InstalmentStream;
	readonly right: InstalmentStream;
	readonly tiers: LadderTiers;
}

interface LadderResult {
	readonly budget: BudgetSnapshot;
	readonly contributions: readonly TierContribution[];
	readonly outcome: AlignmentOutcome;
}

// Run T1, then T2, then always T3 — T3 handles specials that never follow the
// title's structural pattern, so it runs even after an earlier rung matched.
// Results and the budget thread through every rung before the accumulated
// pairings are aligned once.
const runLadder = (input: LadderInput): LadderResult => {
	const { budget, left, right, tiers } = input;
	const rungs: readonly Tier[] = [tiers.t1, tiers.t2, tiers.t3];
	const contributions: TierContribution[] = [];
	const placed: TierLink[] = [];
	let order: MatchingOrder = {
		left: indexStream(left),
		right: indexStream(right),
	};
	for (const rung of rungs) {
		const proposal = rung.propose({ budget, left, order, placed, right });
		contributions.push({ proposal, tier: rung.id });
		if (proposal.kind === "proposed") {
			placed.push(...proposal.links);
			const { order: proposedOrder } = proposal;
			if (proposedOrder !== undefined) {
				order = proposedOrder;
			}
		}
	}
	const overBudget = contributions.some(
		(contribution) => contribution.proposal.kind === "over-budget",
	);
	return {
		budget: budget.snapshot(),
		contributions,
		outcome: overBudget
			? { reason: "over-budget", status: "unmatched" }
			: alignStreams({ left, links: placed, order, right }),
	};
};

export { runLadder, tierIds };
export type {
	LadderInput,
	LadderResult,
	LadderTiers,
	Tier,
	TierContext,
	TierContribution,
	TierId,
	TierProposal,
};
