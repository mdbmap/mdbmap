// The pre-fetch estimate (ADR-0002 §overflow): before enumerating full instalment
// lists, discovery sizes the work from the chain and candidate counts alone. Work
// that fits a conservative request budget runs synchronously; work that does not
// becomes one idempotent background build.

// The cheap counts a cold discovery pass yields before any list fetch.
interface EstimateInput {
	// Segments (member titles) across the discovered continuity chain.
	readonly chainSegments: number;
	// Target-service candidate ids on the chain awaiting verification.
	readonly targetCandidates: number;
	// Distinct target services the fan-out will compare against.
	readonly targetServices: number;
}

// A transparent request-cost model. Each field is a per-unit request price; the
// budget is the conservative ceiling a synchronous invocation stays under.
interface OverflowBudget {
	readonly candidateVerifyCost: number;
	readonly requestBudget: number;
	readonly segmentFetchCost: number;
}

interface WorkEstimate {
	readonly estimatedRequests: number;
	readonly fitsBudget: boolean;
}

// Conservative by design: the platform ceiling is not the matching budget
// (ADR-0002). Kept above the tiers' inline fetch budgets so ordinary single-title
// work stays synchronous and only genuine fan-outs overflow.
const defaultOverflowBudget: OverflowBudget = {
	candidateVerifyCost: 1,
	requestBudget: 50,
	segmentFetchCost: 1,
};

const estimatedRequests = (
	input: EstimateInput,
	budget: OverflowBudget,
): number =>
	input.chainSegments * input.targetServices * budget.segmentFetchCost +
	input.targetCandidates * budget.candidateVerifyCost;

const estimateBuild = (
	input: EstimateInput,
	budget: OverflowBudget = defaultOverflowBudget,
): WorkEstimate => {
	const requests = estimatedRequests(input, budget);
	return {
		estimatedRequests: requests,
		fitsBudget: requests <= budget.requestBudget,
	};
};

export { defaultOverflowBudget, estimateBuild };
export type { EstimateInput, OverflowBudget, WorkEstimate };
