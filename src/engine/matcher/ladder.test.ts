import { describe, expect, it } from "vitest";

import { createBudget } from "./budget.ts";
import { runLadder } from "./ladder.ts";
import type { Tier, TierContext } from "./ladder.ts";
import type { CandidatePairing } from "./monotonic.ts";
import {
	pair,
	regular,
	special,
	staticTier,
	streamOf,
} from "./test-fixtures.ts";

describe("createBudget", () => {
	it("grants within the limit and refuses an overrun without deducting", () => {
		const budget = createBudget(6);
		expect(budget.spend(4)).toBe(true);
		expect(budget.spend(3)).toBe(false);
		expect(budget.snapshot()).toStrictEqual({
			limit: 6,
			remaining: 2,
			spent: 4,
		});
	});
});

describe("runLadder", () => {
	const left = streamOf([regular("l#1"), regular("l#2"), special("l#sp")]);
	const right = streamOf([regular("r#1"), regular("r#2"), special("r#sp")]);

	it("runs T1 then T2 then always T3, threading placements and budget", () => {
		const seen: { placed: number; tier: string }[] = [];
		const recorder = (
			id: Tier["id"],
			pairings: readonly CandidatePairing[],
			cost: number,
		): Tier => ({
			id,
			propose: (context: TierContext) => {
				context.budget.spend(cost);
				seen.push({ placed: context.placed.length, tier: id });
				return {
					kind: "proposed",
					links: pairings.map((pairing) => ({
						confidence: "high",
						left: pairing.left,
						right: pairing.right,
					})),
				};
			},
		});

		const result = runLadder({
			budget: createBudget(10),
			left,
			right,
			tiers: {
				t1: recorder("t1-structure", [pair(["l#1"], ["r#1"])], 3),
				t2: recorder("t2-pattern", [pair(["l#2"], ["r#2"])], 2),
				t3: recorder("t3-episode", [pair(["l#sp"], ["r#sp"])], 1),
			},
		});

		expect(seen).toStrictEqual([
			{ placed: 0, tier: "t1-structure" },
			{ placed: 1, tier: "t2-pattern" },
			{ placed: 2, tier: "t3-episode" },
		]);
		expect(result.budget.spent).toBe(6);
		expect(result.contributions.map((entry) => entry.tier)).toStrictEqual([
			"t1-structure",
			"t2-pattern",
			"t3-episode",
		]);
		expect(result.outcome.status).toBe("published");
		if (result.outcome.status === "published") {
			expect(result.outcome.alignment.pairs).toHaveLength(3);
		}
	});

	it("surfaces a conflict when threaded proposals cross", () => {
		const result = runLadder({
			budget: createBudget(10),
			left,
			right,
			tiers: {
				t1: staticTier("t1-structure", [pair(["l#1"], ["r#2"])]),
				t2: staticTier("t2-pattern", [pair(["l#2"], ["r#1"])]),
				t3: staticTier("t3-episode", []),
			},
		});
		expect(result.outcome.status).toBe("conflict");
	});

	it("keeps an over-budget refusal unmatched without publishing absences", () => {
		const result = runLadder({
			budget: createBudget(0),
			left,
			right,
			tiers: {
				t1: {
					id: "t1-structure",
					propose: () => ({ kind: "over-budget" }),
				},
				t2: staticTier("t2-pattern", []),
				t3: staticTier("t3-episode", []),
			},
		});

		expect(result.outcome).toStrictEqual({
			reason: "over-budget",
			status: "unmatched",
		});
	});

	it("distinguishes an empty proposal from an over-budget refusal", () => {
		const result = runLadder({
			budget: createBudget(0),
			left,
			right,
			tiers: {
				t1: staticTier("t1-structure", []),
				t2: staticTier("t2-pattern", []),
				t3: staticTier("t3-episode", []),
			},
		});

		expect(result.outcome.status).toBe("published");
		if (result.outcome.status === "published") {
			expect(result.outcome.alignment.left.noCounterpart).toStrictEqual([
				"l#1",
				"l#2",
				"l#sp",
			]);
		}
	});

	it("preserves link confidence through final alignment", () => {
		const result = runLadder({
			budget: createBudget(0),
			left,
			right,
			tiers: {
				t1: staticTier("t1-structure", []),
				t2: staticTier("t2-pattern", []),
				t3: {
					id: "t3-episode",
					propose: () => ({
						kind: "proposed",
						links: [
							{
								confidence: "low",
								left: ["l#1"],
								right: ["r#1"],
							},
						],
					}),
				},
			},
		});

		expect(result.outcome.status).toBe("published");
		if (result.outcome.status === "published") {
			expect(result.outcome.alignment.pairs[0]?.confidence).toBe("low");
		}
	});
});
