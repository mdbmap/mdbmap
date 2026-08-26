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
	validated: true,
	verdict: "corroborates",
	...overrides,
});

describe("corroborate", () => {
	it("returns high for two operators including a validated API response", () => {
		expect(corroborate([api("tvdb"), api("tmdb")])).toStrictEqual({
			confidence: "high",
			reviewFlag: undefined,
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
			corroborate([
				api("tvdb"),
				api("tvdb", { validated: false }),
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
					verdict: "corroborates",
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
				api("anidb", { verdict: "contradicts" }),
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
					verdict: "corroborates",
				},
			]),
		).toStrictEqual({
			confidence: "low",
			reviewFlag: "low-confidence-flag",
		});
	});

	it("ignores community wikis and unofficial evidence", () => {
		expect(
			corroborate([
				api("tvdb"),
				api("tmdb"),
				{
					kind: "community-wiki",
					official: false,
					operator: "fandom",
					verdict: "contradicts",
				},
				api("anidb", { official: false, verdict: "contradicts" }),
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
