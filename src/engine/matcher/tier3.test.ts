import { describe, expect, it } from "vitest";

import type { InstalmentLocator } from "@/db/schema";

import { createBudget } from "./budget.ts";
import { alignStreams } from "./framework.ts";
import { runLadder } from "./ladder.ts";
import type { CandidatePairing } from "./monotonic.ts";
import {
	locator,
	pair,
	regular,
	special,
	staticTier,
	streamOf,
} from "./test-fixtures.ts";
import { createTier3, matchTier3 } from "./tier3.ts";
import type { FactsByLocator, InstalmentFacts } from "./tier3.ts";

const factsOf = (
	entries: readonly (readonly [string, InstalmentFacts])[],
): FactsByLocator => {
	const map = new Map<InstalmentLocator, InstalmentFacts>();
	for (const [raw, fact] of entries) {
		map.set(locator(raw), fact);
	}
	return map;
};

describe("matchTier3", () => {
	it("merges two same-day halves into one unit of three spokes (Paw Patrol)", () => {
		// Two ~11-minute TMDB halves share an air date; IMDb carries them as one
		// ~22-minute episode. The combined same-day candidate's summed runtime beats
		// either half alone, so the split resolves to one content unit.
		const left = streamOf([regular("tmdb#1a"), regular("tmdb#1b")]);
		const right = streamOf([regular("imdb#1")]);
		const facts = factsOf([
			[
				"tmdb#1a",
				{
					airDate: "2013-08-12",
					runtime: 11,
					title: "Pups and the Kitty-tastrophe",
				},
			],
			["tmdb#1b", { airDate: "2013-08-12", runtime: 11, title: "Pups Save a Train" }],
			[
				"imdb#1",
				{
					airDate: "2013-08-12",
					runtime: 22,
					title: "Pups and the Kitty-tastrophe / Pups Save a Train",
				},
			],
		]);

		const result = matchTier3({ facts, left, right });
		expect(result.links).toHaveLength(1);
		const [link] = result.links;
		expect(link?.pairing.left).toStrictEqual([
			locator("tmdb#1a"),
			locator("tmdb#1b"),
		]);
		expect(link?.pairing.right).toStrictEqual([locator("imdb#1")]);
		expect(link?.confidence).toBe("high");
		expect(link?.flagged).toBe(false);
		expect(result.unlinkedLeft).toStrictEqual([]);
		expect(result.unlinkedRight).toStrictEqual([]);

		const outcome = alignStreams(
			left,
			right,
			result.links.map((entry) => entry.pairing),
		);
		expect(outcome.status).toBe("published");
	});

	it("lands a season-0 special on its late regular counterpart (AoT)", () => {
		// T1 already paired the opening regulars; T3 still runs and places the
		// TMDB season-0 special on the late IMDb episode it actually is, not the
		// nearer unmatched one.
		const left = streamOf([regular("tmdb#1"), special("tmdb#ova")]);
		const right = streamOf([
			regular("imdb#1"),
			regular("imdb#2"),
			regular("imdb#late"),
		]);
		const placed: readonly CandidatePairing[] = [pair(["tmdb#1"], ["imdb#1"])];
		const facts = factsOf([
			["tmdb#1", { airDate: "2013-04-07", title: "To You, in 2000 Years" }],
			["tmdb#ova", { airDate: "2014-08-25", title: "Ilse's Notebook" }],
			["imdb#1", { airDate: "2013-04-07", title: "To You, in 2000 Years" }],
			["imdb#2", { airDate: "2013-04-14", title: "That Day" }],
			["imdb#late", { airDate: "2014-08-25", title: "Ilse's Notebook" }],
		]);

		const result = matchTier3({ facts, left, placed, right });
		expect(result.links).toHaveLength(1);
		const [link] = result.links;
		expect(link?.pairing.left).toStrictEqual([locator("tmdb#ova")]);
		expect(link?.pairing.right).toStrictEqual([locator("imdb#late")]);
		expect(link?.confidence).toBe("high");
		expect(result.unlinkedRight).toStrictEqual([locator("imdb#2")]);

		const pairings = [...placed, ...result.links.map((entry) => entry.pairing)];
		expect(alignStreams(left, right, pairings).status).toBe("published");
	});

	it("links a mid-band title-only match as low and flagged", () => {
		const left = streamOf([special("l#beach")]);
		const right = streamOf([special("r#beach")]);
		const facts = factsOf([
			["l#beach", { title: "Beach Episode" }],
			["r#beach", { title: "Beach Day Episode" }],
		]);

		const result = matchTier3({ facts, left, right });
		expect(result.links).toHaveLength(1);
		const [link] = result.links;
		expect(link?.confidence).toBe("low");
		expect(link?.flagged).toBe(true);
		expect(link?.score).toBeGreaterThanOrEqual(0.5);
		expect(link?.score).toBeLessThan(0.8);
	});

	it("leaves a below-band instalment as an unlinked spoke", () => {
		const left = streamOf([regular("l#recap")]);
		const right = streamOf([regular("r#finale")]);
		const facts = factsOf([
			["l#recap", { title: "Recap" }],
			["r#finale", { title: "Finale" }],
		]);

		const result = matchTier3({ facts, left, right });
		expect(result.links).toStrictEqual([]);
		expect(result.unlinkedLeft).toStrictEqual([locator("l#recap")]);
		expect(result.unlinkedRight).toStrictEqual([locator("r#finale")]);

		const outcome = alignStreams(left, right, []);
		expect(outcome.status).toBe("published");
		if (outcome.status === "published") {
			expect(outcome.alignment.left.noCounterpart).toStrictEqual([
				locator("l#recap"),
			]);
		}
	});

	it("never links on runtime or position alone without an identifying signal", () => {
		const left = streamOf([regular("l#1")]);
		const right = streamOf([regular("r#1")]);
		const facts = factsOf([
			["l#1", { runtime: 24 }],
			["r#1", { runtime: 24 }],
		]);

		const result = matchTier3({ facts, left, right });
		expect(result.links).toStrictEqual([]);
		expect(result.unlinkedLeft).toStrictEqual([locator("l#1")]);
	});

	it("disqualifies a candidate whose air dates fall past the tolerance", () => {
		// Titles match perfectly, but the dates are four days apart — a hard
		// disqualification, not weak evidence a title could rescue.
		const left = streamOf([regular("l#1")]);
		const right = streamOf([regular("r#1")]);
		const facts = factsOf([
			["l#1", { airDate: "2020-01-01", title: "Origin" }],
			["r#1", { airDate: "2020-01-05", title: "Origin" }],
		]);

		expect(matchTier3({ facts, left, right }).links).toStrictEqual([]);
	});
});

describe("matchTier3 position support", () => {
	it("breaks a same-day tie by position, aligning like with like", () => {
		// All four share one air date and carry no title, so date alone is
		// identifying and every pair is comparable. Only the position bonus
		// separates them, ranking the aligned pairs above the displaced ones so the
		// greedy pass links like with like.
		const left = streamOf([regular("l#1"), regular("l#2")]);
		const right = streamOf([regular("r#1"), regular("r#2")]);
		const facts = factsOf([
			["l#1", { airDate: "2023-06-01" }],
			["l#2", { airDate: "2023-06-01" }],
			["r#1", { airDate: "2023-06-01" }],
			["r#2", { airDate: "2023-06-01" }],
		]);

		const result = matchTier3({ facts, left, right });
		expect(result.links.map((link) => link.pairing)).toStrictEqual([
			{ left: [locator("l#1")], right: [locator("r#1")] },
			{ left: [locator("l#2")], right: [locator("r#2")] },
		]);
	});

	it("lets the position bonus carry a boundary-date pair over the high band", () => {
		// Dates a day apart score 0.78 on their own — below the high band. The two
		// aligned regulars share a position, so the 0.05 position bonus is the only
		// thing lifting the link to `high`.
		const left = streamOf([regular("l#1")]);
		const right = streamOf([regular("r#1")]);
		const facts = factsOf([
			["l#1", { airDate: "2021-01-02" }],
			["r#1", { airDate: "2021-01-01" }],
		]);

		const result = matchTier3({ facts, left, right });
		expect(result.links).toHaveLength(1);
		const [link] = result.links;
		expect(link?.confidence).toBe("high");
		expect(link?.flagged).toBe(false);
		expect(link?.score).toBeGreaterThanOrEqual(0.8);
	});

	it("zeroes the position bonus for specials, leaving the same pair low", () => {
		// Identical to the case above but with specials, whose slots carry no
		// scoring weight. Without the position bonus the pair sits at 0.78, so it
		// links `low` and flagged rather than `high`.
		const left = streamOf([special("l#1")]);
		const right = streamOf([special("r#1")]);
		const facts = factsOf([
			["l#1", { airDate: "2021-01-02" }],
			["r#1", { airDate: "2021-01-01" }],
		]);

		const result = matchTier3({ facts, left, right });
		expect(result.links).toHaveLength(1);
		const [link] = result.links;
		expect(link?.confidence).toBe("low");
		expect(link?.flagged).toBe(true);
		expect(link?.score).toBeGreaterThanOrEqual(0.5);
		expect(link?.score).toBeLessThan(0.8);
	});

	it("gives a special no position weight, matching it purely on identity", () => {
		// The special is stored early but its counterpart is the late regular. With
		// no position weight the date carries it to the late episode; a position
		// bonus would instead have pulled it to the near one.
		const left = streamOf([special("l#sp"), regular("l#1")]);
		const right = streamOf([regular("r#1"), regular("r#late")]);
		const facts = factsOf([
			["l#sp", { airDate: "2020-12-31", title: "Special" }],
			["l#1", { airDate: "2020-01-01", title: "Opener" }],
			["r#1", { airDate: "2020-01-01", title: "Opener" }],
			["r#late", { airDate: "2020-12-31", title: "Special" }],
		]);

		const result = matchTier3({ facts, left, right });
		const special3 = result.links.find((link) =>
			link.pairing.left.includes(locator("l#sp")),
		);
		expect(special3?.pairing.right).toStrictEqual([locator("r#late")]);
	});
});

describe("matchTier3 same-day runs", () => {
	it("does not combine same-day members split by a consumed one", () => {
		// A, B and C share an air date, but B is already claimed by an earlier rung.
		// A and C are therefore not consecutive in the stream, so they must stay
		// separate units and never merge into one that would falsely swallow the
		// summed-runtime counterpart.
		const left = streamOf([regular("l#a"), regular("l#b"), regular("l#c")]);
		const right = streamOf([regular("r#b"), regular("r#merge")]);
		const placed: readonly CandidatePairing[] = [pair(["l#b"], ["r#b"])];
		const facts = factsOf([
			["l#a", { airDate: "2021-01-01", runtime: 11, title: "Alpha" }],
			["l#b", { airDate: "2021-01-01", runtime: 11, title: "Beta" }],
			["l#c", { airDate: "2021-01-01", runtime: 11, title: "Gamma" }],
			["r#merge", { airDate: "2021-01-01", runtime: 22, title: "Alpha Gamma" }],
		]);

		const result = matchTier3({ facts, left, placed, right });
		const merged = result.links.find((link) => link.pairing.left.length > 1);
		expect(merged).toBeUndefined();
	});
});

describe("matchTier3 boundaries", () => {
	it("keeps an airing stream's unaired tail pending, not no-counterpart", () => {
		const left = streamOf(
			[regular("l#1"), regular("l#2"), regular("l#3")],
			"airing",
		);
		const right = streamOf([regular("r#1")]);
		const facts = factsOf([
			["l#1", { airDate: "2023-01-01", title: "One" }],
			["l#2", { airDate: "2023-01-08", title: "Two" }],
			["l#3", { airDate: "2023-01-15", title: "Three" }],
			["r#1", { airDate: "2023-01-01", title: "One" }],
		]);

		const result = matchTier3({ facts, left, right });
		expect(result.links).toHaveLength(1);
		// l#2 and l#3 sit past the settled prefix (last paired is l#1), so both
		// stay pending rather than settling as final absences.
		expect(result.unlinkedLeft).toStrictEqual([]);
		expect(result.pendingLeft).toStrictEqual([locator("l#2"), locator("l#3")]);
	});

	it("settles nothing for a truncated stream", () => {
		const left = streamOf([regular("l#1"), regular("l#2")], "truncated");
		const right = streamOf([regular("r#1")]);
		const facts = factsOf([
			["l#1", { airDate: "2023-01-01", title: "One" }],
			["l#2", { airDate: "2023-02-01", title: "Two" }],
			["r#1", { airDate: "2023-01-01", title: "One" }],
		]);

		const result = matchTier3({ facts, left, right });
		expect(result.links).toHaveLength(1);
		expect(result.unlinkedLeft).toStrictEqual([]);
		expect(result.pendingLeft).toStrictEqual([locator("l#2")]);
	});
});

describe("matchTier3 monotonicity", () => {
	it("drops a crossing candidate instead of conflicting the whole set", () => {
		// Both content-correct pairs are strong, but the right stream stores them
		// in reversed order, so linking both would cross. The greedy pass keeps the
		// first and drops the crosser, leaving a publishable alignment rather than a
		// conflict that would also discard earlier rungs.
		const left = streamOf([regular("l#1"), regular("l#2")]);
		const right = streamOf([regular("r#1"), regular("r#2")]);
		const facts = factsOf([
			["l#1", { airDate: "2021-01-02", title: "Beta" }],
			["l#2", { airDate: "2021-01-01", title: "Alpha" }],
			["r#1", { airDate: "2021-01-01", title: "Alpha" }],
			["r#2", { airDate: "2021-01-02", title: "Beta" }],
		]);

		const result = matchTier3({ facts, left, right });
		expect(result.links).toHaveLength(1);
		const outcome = alignStreams(
			left,
			right,
			result.links.map((entry) => entry.pairing),
		);
		expect(outcome.status).toBe("published");
	});

	it("holds a crossing-rejected candidate's members as pending, not unlinked", () => {
		// The reversed pair l#2 ↔ r#1 scores as strongly as the linked one but
		// crosses, so it is dropped. Both sides had a real above-band counterpart,
		// so they queue as conflicts for review rather than hardening into final
		// no-counterpart spokes on these complete streams.
		const left = streamOf([regular("l#1"), regular("l#2")]);
		const right = streamOf([regular("r#1"), regular("r#2")]);
		const facts = factsOf([
			["l#1", { airDate: "2021-01-02", title: "Beta" }],
			["l#2", { airDate: "2021-01-01", title: "Alpha" }],
			["r#1", { airDate: "2021-01-01", title: "Alpha" }],
			["r#2", { airDate: "2021-01-02", title: "Beta" }],
		]);

		const result = matchTier3({ facts, left, right });
		expect(result.links).toHaveLength(1);
		expect(result.unlinkedLeft).toStrictEqual([]);
		expect(result.unlinkedRight).toStrictEqual([]);
		expect(result.pendingLeft).toStrictEqual([locator("l#2")]);
		expect(result.pendingRight).toStrictEqual([locator("r#1")]);
	});
});

describe("createTier3", () => {
	it("runs as the ladder's last rung and places a special after T1", () => {
		const left = streamOf([regular("l#1"), special("l#sp")]);
		const right = streamOf([regular("r#1"), regular("r#2")]);
		const facts = factsOf([
			["l#1", { airDate: "2021-01-01", title: "Premiere" }],
			["l#sp", { airDate: "2021-03-01", title: "Bonus" }],
			["r#1", { airDate: "2021-01-01", title: "Premiere" }],
			["r#2", { airDate: "2021-03-01", title: "Bonus" }],
		]);

		const result = runLadder({
			budget: createBudget(10),
			left,
			right,
			tiers: {
				t1: staticTier("t1-structure", [pair(["l#1"], ["r#1"])]),
				t2: staticTier("t2-pattern", []),
				t3: createTier3(facts),
			},
		});

		expect(result.outcome.status).toBe("published");
		if (result.outcome.status === "published") {
			expect(result.outcome.alignment.pairs).toHaveLength(2);
		}
		const t3 = result.contributions.find((entry) => entry.tier === "t3-episode");
		expect(t3?.pairings).toStrictEqual([pair(["l#sp"], ["r#2"])]);
	});
});
