import { describe, expect, it } from "vitest";

import { createBudget } from "./budget.ts";
import type { BudgetLedger } from "./budget.ts";
import { runLadder } from "./ladder.ts";
import type { Tier, TierContext } from "./ladder.ts";
import { indexStream } from "./monotonic.ts";
import { createT1StructureTier } from "./t1-structure.ts";
import type { T1Segment, T1Side } from "./t1-structure.ts";
import { locator, regular, streamOf } from "./test-fixtures.ts";

const noOpTier = (id: Tier["id"]): Tier => ({
	id,
	propose: () => ({ kind: "proposed", links: [] }),
});

// One regular segment: `count` instalments numbered 1..count, each stamped
// with `airDate` (or left unknown when omitted).
const segment = (
	segmentNumber: number,
	count: number,
	airDate?: string,
): T1Segment => ({
	instalments: Array.from({ length: count }, (_ignored, index) => ({
		airDate,
		instalmentNumber: index + 1,
		locator: locator(`s${segmentNumber}e${index + 1}`),
	})),
	number: segmentNumber,
});

const sideOf = (...segments: readonly T1Segment[]): T1Side => ({ segments });

// A stream matching `side`'s locators exactly, so the ladder never rejects a
// T1 pairing as a stray.
const streamFor = (side: T1Side) =>
	streamOf(
		side.segments.flatMap((entry) =>
			entry.instalments.map((instalment) => regular(instalment.locator)),
		),
	);

const contextFor = (
	left: T1Side,
	right: T1Side,
	budget: BudgetLedger,
): TierContext => {
	const leftStream = streamFor(left);
	const rightStream = streamFor(right);
	return {
		budget,
		left: leftStream,
		order: {
			left: indexStream(leftStream),
			right: indexStream(rightStream),
		},
		placed: [],
		right: rightStream,
	};
};

describe("createT1StructureTier", () => {
	it("maps two structurally identical titles with t1-structure provenance", () => {
		const left = sideOf(segment(1, 2), segment(2, 3));
		const right = sideOf(segment(1, 2), segment(2, 3));
		const tier = createT1StructureTier({ cost: 5, left, right });

		const result = runLadder({
			budget: createBudget(10),
			left: streamFor(left),
			right: streamFor(right),
			tiers: {
				t1: tier,
				t2: noOpTier("t2-pattern"),
				t3: noOpTier("t3-episode"),
			},
		});

		expect(result.outcome.status).toBe("published");
		if (result.outcome.status === "published") {
			expect(result.outcome.alignment.pairs).toHaveLength(5);
			expect(result.outcome.alignment.left.noCounterpart).toStrictEqual([]);
			expect(result.outcome.alignment.right.noCounterpart).toStrictEqual([]);
		}
		expect(result.contributions[0]).toMatchObject({ tier: "t1-structure" });
		const proposal = result.contributions[0]?.proposal;
		expect(proposal?.kind).toBe("proposed");
		if (proposal?.kind === "proposed") {
			expect(proposal.links).toHaveLength(5);
		}
	});

	it("persists an explicit unmatched group when instalment counts mismatch", () => {
		const left = sideOf(segment(1, 2));
		const right = sideOf(segment(1, 3));
		const tier = createT1StructureTier({ cost: 5, left, right });

		const result = runLadder({
			budget: createBudget(10),
			left: streamFor(left),
			right: streamFor(right),
			tiers: {
				t1: tier,
				t2: noOpTier("t2-pattern"),
				t3: noOpTier("t3-episode"),
			},
		});

		expect(result.contributions[0]?.proposal).toStrictEqual({
			kind: "proposed",
			links: [],
		});
		expect(result.outcome.status).toBe("published");
		if (result.outcome.status === "published") {
			expect(result.outcome.alignment.pairs).toStrictEqual([]);
			expect(result.outcome.alignment.left.noCounterpart).toStrictEqual([
				locator("s1e1"),
				locator("s1e2"),
			]);
		}
	});

	it("persists an explicit unmatched group when a spot-checked air date disagrees", () => {
		const left = sideOf(segment(1, 2, "2024-01-01"));
		const right = sideOf(segment(1, 2, "2024-06-01"));
		const tier = createT1StructureTier({ cost: 5, left, right });

		const proposal = tier.propose(contextFor(left, right, createBudget(10)));
		expect(proposal).toStrictEqual({ kind: "proposed", links: [] });
	});

	it("maps titles whose air dates differ by a day (timezone/simulcast skew)", () => {
		const left = sideOf(segment(1, 2, "2024-06-01"));
		const right = sideOf(segment(1, 2, "2024-06-02"));
		const tier = createT1StructureTier({ cost: 5, left, right });

		const proposal = tier.propose(contextFor(left, right, createBudget(10)));
		expect(proposal.kind).toBe("proposed");
		if (proposal.kind === "proposed") {
			expect(proposal.links).toHaveLength(2);
		}
	});

	it("ignores a missing air date rather than treating it as a disagreement", () => {
		const left = sideOf(segment(1, 2));
		const right = sideOf(segment(1, 2, "2024-06-01"));
		const tier = createT1StructureTier({ cost: 5, left, right });

		const proposal = tier.propose(contextFor(left, right, createBudget(10)));
		expect(proposal.kind).toBe("proposed");
		if (proposal.kind === "proposed") {
			expect(proposal.links).toHaveLength(2);
		}
	});

	it("persists an explicit unmatched group when segment numbers differ", () => {
		const left = sideOf(segment(1, 2));
		const right = sideOf(segment(2, 2));
		const tier = createT1StructureTier({ cost: 5, left, right });

		const proposal = tier.propose(contextFor(left, right, createBudget(10)));
		expect(proposal).toStrictEqual({ kind: "proposed", links: [] });
	});

	it("persists a bare unmatched group with no spokes when over budget", () => {
		const left = sideOf(segment(1, 2));
		const right = sideOf(segment(1, 2));
		const tier = createT1StructureTier({ cost: 26, left, right });
		const budget = createBudget(25);

		const proposal = tier.propose(contextFor(left, right, budget));
		expect(proposal).toStrictEqual({ kind: "over-budget" });
		// The refused spend must not deduct: a later tier still sees the full
		// budget, and no evidence was ever compared to justify a spoke.
		expect(budget.snapshot()).toStrictEqual({
			limit: 25,
			remaining: 25,
			spent: 0,
		});
	});
});
