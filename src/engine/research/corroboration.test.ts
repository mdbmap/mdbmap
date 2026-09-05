import { describe, expect, it } from "vitest";

import type { CorroborationEvidence } from "./corroboration.ts";
import { corroborate } from "./corroboration.ts";

const api = (
	operator: string,
	overrides: Partial<Extract<CorroborationEvidence, { kind: "api" }>> = {},
): CorroborationEvidence => ({
	kind: "api",
	official: true,
	operator,
	stance: "corroborates",
	url: `https://api.example/${operator}`,
	validated: true,
	...overrides,
});

describe("corroborate", () => {
	it("returns low when a second operator is only an unavailable API check", () => {
		expect(
			corroborate([api("tvdb"), api("tmdb", { validated: false })]),
		).toStrictEqual({
			confidence: "low",
			reviewFlag: "low-confidence-flag",
		});
	});

	it("returns low and flags empty evidence", () => {
		expect(corroborate([])).toStrictEqual({
			confidence: "low",
			reviewFlag: "low-confidence-flag",
		});
	});

	it("returns low and flags evidence from a single operator", () => {
		expect(
			corroborate([api("tvdb"), api("tvdb", { validated: false })]),
		).toStrictEqual({
			confidence: "low",
			reviewFlag: "low-confidence-flag",
		});
	});

	it("normalizes operator names before checking independence", () => {
		expect(corroborate([api("AniList"), api(" anilist ")])).toStrictEqual({
			confidence: "low",
			reviewFlag: "low-confidence-flag",
		});
	});

	it("requires the validated API to name a counting operator", () => {
		expect(
			corroborate([
				api("tvdb", { validated: false }),
				api("tmdb", { validated: false }),
				api("", { validated: true }),
			]),
		).toStrictEqual({
			confidence: "low",
			reviewFlag: "low-confidence-flag",
		});
	});

	it("returns low and flags a scrape leg", () => {
		expect(
			corroborate([
				api("tvdb"),
				{
					kind: "scrape",
					official: true,
					operator: "tmdb",
					stance: "corroborates",
					url: "https://www.themoviedb.org/tv/1",
				},
			]),
		).toStrictEqual({
			confidence: "low",
			reviewFlag: "low-confidence-flag",
		});
	});

	it("returns low and flags contradicting official evidence", () => {
		expect(
			corroborate([
				api("tvdb"),
				api("tmdb"),
				api("anidb", { stance: "contradicts" }),
			]),
		).toStrictEqual({
			confidence: "low",
			reviewFlag: "low-confidence-flag",
		});
	});

	it("does not count a community wiki as an independent operator", () => {
		expect(
			corroborate([
				api("tvdb"),
				{
					kind: "community-wiki",
					official: false,
					operator: "fandom",
					stance: "corroborates",
				},
			]),
		).toStrictEqual({
			confidence: "low",
			reviewFlag: "low-confidence-flag",
		});
	});

	it("ignores community wiki evidence", () => {
		expect(
			corroborate([
				api("tvdb"),
				api("tmdb"),
				{
					kind: "community-wiki",
					official: false,
					operator: "fandom",
					stance: "contradicts",
				},
			]),
		).toStrictEqual({
			confidence: "high",
			reviewFlag: undefined,
		});
	});

	it("requires the API response to be validated", () => {
		expect(
			corroborate([
				api("tvdb", { validated: false }),
				api("tmdb", { validated: false }),
			]),
		).toStrictEqual({
			confidence: "low",
			reviewFlag: "low-confidence-flag",
		});
	});
});
