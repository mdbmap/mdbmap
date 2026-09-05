import { describe, expect, it } from "vitest";

import type { EpisodeView, PartView, WorkBlock } from "@/orpc/schema";

import { resolveSelectedIndex, workGetInput } from "./part-state";

const emptyScore = { count: 0, mean: undefined };

const episode = (locator: string): EpisodeView => ({
	airDate: "2022-04-09",
	communityScore: emptyScore,
	instalmentLocator: locator,
	number: 1,
	personalRating: undefined,
	rateableUnit: { key: `episode:${locator}`, kind: "episode" },
	title: locator,
	watched: false,
});

const part = (key: string): PartView => ({
	airedFrom: undefined,
	airedTo: undefined,
	communityScore: emptyScore,
	episodeCount: 1,
	episodes: [episode(`${key}:1`)],
	kind: "part",
	label: key,
	personalRating: undefined,
	rateableUnit: { key, kind: "part" },
	serviceRatings: [],
	year: 2022,
});

const blocks = (...keys: string[]): WorkBlock[] => keys.map((key) => part(key));

describe("resolveSelectedIndex", () => {
	it("defaults an untouched selection to the last part", () => {
		expect(resolveSelectedIndex(undefined, blocks("a", "b", "c"))).toBe(2);
	});

	it("keeps an explicit in-range selection", () => {
		expect(resolveSelectedIndex("b", blocks("a", "b", "c"))).toBe(1);
	});

	it("falls back to the last part when the stored key is absent", () => {
		expect(resolveSelectedIndex("missing", blocks("a", "b"))).toBe(1);
	});

	it("stays at zero when there are no parts", () => {
		expect(resolveSelectedIndex(undefined, [])).toBe(0);
	});
});

describe("workGetInput", () => {
	it("omits order when the viewer has not chosen one", () => {
		expect(workGetInput("continuity:x")).toEqual({
			continuityId: "continuity:x",
			locale: "en",
		});
	});

	it("includes the selected presentation order", () => {
		expect(workGetInput("continuity:x", "watch")).toEqual({
			continuityId: "continuity:x",
			locale: "en",
			order: "watch",
		});
	});

	it("includes a community proposal id", () => {
		expect(workGetInput("continuity:x", { proposalId: 7 })).toEqual({
			continuityId: "continuity:x",
			locale: "en",
			proposalId: 7,
		});
	});
});
