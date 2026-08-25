import { describe, expect, it } from "vitest";

import { metadataProviderFor, stubEngine } from "./index.ts";

describe("stubEngine.resolveContinuity", () => {
	const result = stubEngine.resolveContinuity("continuity:spy-x-family");

	it("routes the anime sample to AniDB per media kind", () => {
		expect(result.mediaKind).toBe("anime");
		expect(metadataProviderFor(result.mediaKind)).toBe("anidb");
	});

	it("returns the three per-cour segments with real member ids", () => {
		expect(result.segments).toHaveLength(3);
		expect(result.segments[0]?.members).toStrictEqual({
			anidb: "16947",
			anilist: "140960",
			mal: "50265",
			tmdb: "120089",
		});
	});

	it("orders instalment locators under the provider member title", () => {
		const [first] = result.segments;
		expect(first?.instalments).toHaveLength(12);
		expect(first?.instalments[0]).toBe("anidb:16947#1");
		expect(first?.instalments.at(-1)).toBe("anidb:16947#12");
	});

	it("throws for an unknown continuity", () => {
		expect(() =>
			stubEngine.resolveContinuity("continuity:unknown"),
		).toThrow(/no fixture/iu);
	});
});

describe("metadataProviderFor", () => {
	it("routes TV and film to TMDB", () => {
		expect(metadataProviderFor("tv")).toBe("tmdb");
		expect(metadataProviderFor("film")).toBe("tmdb");
	});
});
