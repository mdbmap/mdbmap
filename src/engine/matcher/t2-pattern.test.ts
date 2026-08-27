import { describe, expect, it } from "vitest";

import { createBudget } from "./budget.ts";
import type { BudgetLedger } from "./budget.ts";
import { runLadder } from "./ladder.ts";
import type { Tier, TierContext, TierProposal } from "./ladder.ts";
import type { CandidatePairing } from "./monotonic.ts";
import { indexStream } from "./monotonic.ts";
import { createT2PatternTier } from "./t2-pattern.ts";
import type {
	EpisodeGroupOrdering,
	EpisodeGroupSummary,
	T2Instalment,
	T2Segment,
	T2Side,
} from "./t2-pattern.ts";
import { locator, regular, streamOf } from "./test-fixtures.ts";

const noOpTier = (id: Tier["id"]): Tier => ({
	id,
	propose: () => ({ kind: "proposed", links: [] }),
});

const proposedLinks = (proposal: TierProposal | undefined) => {
	expect(proposal?.kind).toBe("proposed");
	return proposal?.kind === "proposed" ? proposal.links : [];
};

const inst = (raw: string, airDate?: string, title?: string): T2Instalment => ({
	airDate,
	locator: locator(raw),
	title,
});

const seg = (
	number: number,
	instalments: readonly T2Instalment[],
): T2Segment => ({
	instalments,
	number,
});

const sideOf = (...segments: readonly T2Segment[]): T2Side => ({ segments });

const summary = (id: string, instalmentCount: number): EpisodeGroupSummary => ({
	id,
	instalmentCount,
});

// A stream whose regular instalments are exactly `side`'s locators, in the order
// the transform pairs them, so the framework never rejects a T2 pairing as a
// stray or a crossing.
const streamFor = (side: T2Side) =>
	streamOf(
		side.segments.flatMap((segment) =>
			segment.instalments.map((instalment) => regular(instalment.locator)),
		),
	);

const contextFor = (
	left: T2Side,
	right: T2Side,
	budget: BudgetLedger,
	placed: readonly CandidatePairing[] = [],
): TierContext => ({
	budget,
	left: streamFor(left),
	order: {
		left: indexStream(streamFor(left)),
		right: indexStream(streamFor(right)),
	},
	placed,
	right: streamFor(right),
});

describe("createT2PatternTier", () => {
	it("maps a continuous run to a segmented one via cumulative renumbering", () => {
		const left = sideOf(
			seg(1, [
				inst("l#1", "2024-01-07"),
				inst("l#2", "2024-01-14"),
				inst("l#3", "2024-01-21"),
				inst("l#4", "2024-01-28"),
			]),
		);
		const right = sideOf(
			seg(1, [inst("r#1", "2024-01-07"), inst("r#2", "2024-01-14")]),
			seg(2, [inst("r#3", "2024-01-21"), inst("r#4", "2024-01-28")]),
		);
		const tier = createT2PatternTier({ left, right });

		const result = runLadder({
			budget: createBudget(10),
			left: streamFor(left),
			right: streamFor(right),
			tiers: {
				t1: noOpTier("t1-structure"),
				t2: tier,
				t3: noOpTier("t3-episode"),
			},
		});

		expect(result.contributions[1]).toMatchObject({ tier: "t2-pattern" });
		expect(proposedLinks(result.contributions[1]?.proposal)).toHaveLength(4);
		expect(result.outcome.status).toBe("published");
		if (result.outcome.status === "published") {
			expect(result.outcome.alignment.pairs).toHaveLength(4);
			expect(result.outcome.alignment.left.noCounterpart).toStrictEqual([]);
			expect(result.outcome.alignment.right.noCounterpart).toStrictEqual([]);
		}
	});

	it("maps a pair whose seasons are shifted by a constant offset", () => {
		const left = sideOf(
			seg(1, [inst("l#1", "2020-04-05"), inst("l#2", "2020-04-12")]),
			seg(2, [inst("l#3", "2021-04-04")]),
		);
		const right = sideOf(
			seg(4, [inst("r#1", "2020-04-05"), inst("r#2", "2020-04-12")]),
			seg(5, [inst("r#3", "2021-04-04")]),
		);
		const tier = createT2PatternTier({ left, right });

		const result = runLadder({
			budget: createBudget(10),
			left: streamFor(left),
			right: streamFor(right),
			tiers: {
				t1: noOpTier("t1-structure"),
				t2: tier,
				t3: noOpTier("t3-episode"),
			},
		});

		expect(result.outcome.status).toBe("published");
		if (result.outcome.status === "published") {
			expect(result.outcome.alignment.pairs).toHaveLength(3);
		}
	});

	it("falls back to title agreement where a pair's air dates are missing", () => {
		const left = sideOf(
			seg(1, [
				inst("l#1", undefined, "The Beginning"),
				inst("l#2", "2024-02-01"),
			]),
		);
		const right = sideOf(
			seg(1, [
				inst("r#1", undefined, "the beginning"),
				inst("r#2", "2024-02-01"),
			]),
		);
		const tier = createT2PatternTier({ left, right });

		const context = contextFor(left, right, createBudget(10));
		expect(proposedLinks(tier.propose(context))).toHaveLength(2);
	});

	it("persists an unmatched group when a proposed pair's dates disagree", () => {
		const left = sideOf(
			seg(1, [inst("l#1", "2024-01-01"), inst("l#2", "2024-01-08")]),
		);
		const right = sideOf(
			seg(1, [inst("r#1", "2024-01-01")]),
			seg(2, [inst("r#2", "2024-09-01")]),
		);
		const tier = createT2PatternTier({ left, right });

		const context = contextFor(left, right, createBudget(10));
		expect(proposedLinks(tier.propose(context))).toStrictEqual([]);
	});

	it("refuses a whole-title fit with no comparable evidence at all", () => {
		const left = sideOf(seg(1, [inst("l#1"), inst("l#2")]));
		const right = sideOf(seg(1, [inst("r#1"), inst("r#2")]));
		const tier = createT2PatternTier({ left, right });

		const context = contextFor(left, right, createBudget(10));
		expect(proposedLinks(tier.propose(context))).toStrictEqual([]);
	});

	it("persists an explicit unmatched group when only part of the title fits", () => {
		const left = sideOf(
			seg(1, [
				inst("l#1", "2024-01-01"),
				inst("l#2", "2024-01-08"),
				inst("l#3", "2024-01-15"),
			]),
		);
		const right = sideOf(
			seg(1, [inst("r#1", "2024-01-01"), inst("r#2", "2024-01-08")]),
			seg(2, [inst("r#3", "2024-01-15"), inst("r#4", "2024-01-22")]),
		);
		const tier = createT2PatternTier({ left, right });

		const result = runLadder({
			budget: createBudget(10),
			left: streamFor(left),
			right: streamFor(right),
			tiers: {
				t1: noOpTier("t1-structure"),
				t2: tier,
				t3: noOpTier("t3-episode"),
			},
		});

		expect(proposedLinks(result.contributions[1]?.proposal)).toStrictEqual([]);
		expect(result.outcome.status).toBe("published");
		if (result.outcome.status === "published") {
			expect(result.outcome.alignment.pairs).toStrictEqual([]);
			expect(result.outcome.alignment.left.noCounterpart).toStrictEqual([
				locator("l#1"),
				locator("l#2"),
				locator("l#3"),
			]);
		}
	});

	it("stands down when T1 has already placed the whole title", () => {
		const left = sideOf(seg(1, [inst("l#1", "2024-01-01")]));
		const right = sideOf(seg(1, [inst("r#1", "2024-01-01")]));
		const tier = createT2PatternTier({ left, right });
		const placed: readonly CandidatePairing[] = [
			{ left: [locator("l#1")], right: [locator("r#1")] },
		];

		const context = contextFor(left, right, createBudget(10), placed);
		expect(proposedLinks(tier.propose(context))).toStrictEqual([]);
	});

	describe("episode groups", () => {
		// The natural left order pairs no dates, so the free transforms never fit;
		// only a re-ordering into `aligned` corroborates against the right side.
		// That re-ordering differs from `scrambledLeft`'s stored order, so it can
		// only publish where the stored order already matches it.
		const right = sideOf(
			seg(1, [
				inst("r#1", "2024-03-01"),
				inst("r#2", "2024-03-08"),
				inst("r#3", "2024-03-15"),
				inst("r#4", "2024-03-22"),
			]),
		);
		const scrambledLeft = sideOf(
			seg(1, [
				inst("l#4", "2024-03-22"),
				inst("l#3", "2024-03-15"),
				inst("l#2", "2024-03-08"),
				inst("l#1", "2024-03-01"),
			]),
		);
		const aligned: EpisodeGroupOrdering = {
			segments: [
				seg(1, [
					inst("l#1", "2024-03-01"),
					inst("l#2", "2024-03-08"),
					inst("l#3", "2024-03-15"),
					inst("l#4", "2024-03-22"),
				]),
			],
		};

		it("selects an accepted ordering that differs from stored order", () => {
			const fetched: string[] = [];
			let listings = 0;
			const budget = createBudget(10);
			const tier = createT2PatternTier({
				episodeGroups: {
					detailCost: 1,
					fetchDetail: (id) => {
						fetched.push(id);
						return aligned;
					},
					list: () => {
						listings += 1;
						return [summary("official", 4)];
					},
					listCost: 1,
				},
				left: scrambledLeft,
				right,
			});

			const proposal = tier.propose(contextFor(scrambledLeft, right, budget));

			expect(proposedLinks(proposal)).toHaveLength(4);
			if (proposal.kind === "proposed") {
				expect(proposal.order).toBeDefined();
			}
			expect(listings).toBe(1);
			expect(fetched).toStrictEqual(["official"]);
			expect(budget.snapshot().spent).toBe(2);
		});

		it("proposes and publishes an ordering that holds against stored order", () => {
			const budget = createBudget(10);
			const tier = createT2PatternTier({
				episodeGroups: {
					detailCost: 1,
					fetchDetail: () => aligned,
					list: () => [summary("official", 4)],
					listCost: 1,
				},
				left: scrambledLeft,
				right,
			});

			// Stored order matches the group ordering (not the scrambled natural
			// order the free transforms saw), so the accepted pairs stay monotonic
			// and the whole build publishes.
			const result = runLadder({
				budget,
				left: streamFor(aligned),
				right: streamFor(right),
				tiers: {
					t1: noOpTier("t1-structure"),
					t2: tier,
					t3: noOpTier("t3-episode"),
				},
			});

			expect(proposedLinks(result.contributions[1]?.proposal)).toHaveLength(4);
			expect(result.outcome.status).toBe("published");
			if (result.outcome.status === "published") {
				expect(result.outcome.alignment.pairs).toHaveLength(4);
			}
		});

		it("carries the selected ordering into final alignment", () => {
			const budget = createBudget(10);
			const tier = createT2PatternTier({
				episodeGroups: {
					detailCost: 1,
					fetchDetail: () => aligned,
					list: () => [summary("official", 4)],
					listCost: 1,
				},
				left: scrambledLeft,
				right,
			});
			const result = runLadder({
				budget,
				left: streamFor(scrambledLeft),
				right: streamFor(right),
				tiers: {
					t1: noOpTier("t1-structure"),
					t2: tier,
					t3: noOpTier("t3-episode"),
				},
			});

			expect(proposedLinks(result.contributions[1]?.proposal)).toHaveLength(4);
			expect(result.outcome.status).toBe("published");
			if (result.outcome.status === "published") {
				expect(result.outcome.alignment.pairs).toHaveLength(4);
			}
		});

		it("stops at three group-detail requests and never fetches a mismatched group", () => {
			const fetched: string[] = [];
			const budget = createBudget(10);
			// Five count-matching candidates, each a wrong ordering, plus one whose
			// count can't cover the right side and must never be fetched.
			const tier = createT2PatternTier({
				episodeGroups: {
					detailCost: 1,
					fetchDetail: (id) => {
						fetched.push(id);
						return scrambledLeft;
					},
					list: () => [
						summary("dvd", 4),
						summary("absolute", 4),
						summary("regional", 4),
						summary("alternate", 4),
						summary("story", 4),
						summary("partial", 2),
					],
					listCost: 1,
				},
				left: scrambledLeft,
				right,
			});

			const proposal = tier.propose(contextFor(scrambledLeft, right, budget));

			expect(proposedLinks(proposal)).toStrictEqual([]);
			expect(fetched).toStrictEqual(["dvd", "absolute", "regional"]);
			expect(budget.snapshot().spent).toBe(4);
		});

		it("spends nothing on episode groups when a free transform already fits", () => {
			let listings = 0;
			const budget = createBudget(10);
			const tier = createT2PatternTier({
				episodeGroups: {
					detailCost: 1,
					fetchDetail: () => aligned,
					list: () => {
						listings += 1;
						return [summary("official", 4)];
					},
					listCost: 1,
				},
				left: aligned,
				right,
			});

			const proposal = tier.propose(contextFor(aligned, right, budget));

			expect(proposedLinks(proposal)).toHaveLength(4);
			expect(listings).toBe(0);
			expect(budget.snapshot().spent).toBe(0);
		});
	});
});
