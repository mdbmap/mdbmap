import { describe, expect, it } from "vitest";

import { defaultOverflowBudget, estimateBuild } from "./estimate.ts";
import type { EstimateInput, OverflowBudget } from "./estimate.ts";

describe("estimateBuild", () => {
	it("keeps ordinary single-title work inside the synchronous budget", () => {
		const input: EstimateInput = {
			chainSegments: 1,
			targetCandidates: 1,
			targetServices: 1,
		};
		const estimate = estimateBuild(input);
		expect(estimate.estimatedRequests).toBe(2);
		expect(estimate.fitsBudget).toBe(true);
	});

	it("overflows a wide fan-out over a long continuity", () => {
		const input: EstimateInput = {
			chainSegments: 40,
			targetCandidates: 6,
			targetServices: 3,
		};
		const estimate = estimateBuild(input);
		expect(estimate.estimatedRequests).toBe(126);
		expect(estimate.fitsBudget).toBe(false);
	});

	it("charges each candidate verification and segment fetch", () => {
		const budget: OverflowBudget = {
			candidateVerifyCost: 2,
			requestBudget: 100,
			segmentFetchCost: 3,
		};
		const input: EstimateInput = {
			chainSegments: 5,
			targetCandidates: 4,
			targetServices: 2,
		};
		expect(estimateBuild(input, budget).estimatedRequests).toBe(
			5 * 2 * 3 + 4 * 2,
		);
	});

	it("sits the default budget above the tiers' inline fetch budgets", () => {
		expect(defaultOverflowBudget.requestBudget).toBeGreaterThan(31);
	});
});
