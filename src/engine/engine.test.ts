import { describe, expect, it } from "vitest";

import { freshDb } from "@/db/test-helpers";

import { createEngine } from "./engine.ts";
import { metadataProviderFor } from "./seam.ts";
import { seedSpyXFamily, seedTmdbContinuity } from "./test-continuity.ts";

const seededEngine = async () => {
	const db = await freshDb();
	const { continuityId } = await seedSpyXFamily(db);
	return { continuityId, read: createEngine(db) };
};

describe("createEngine.resolveContinuity", () => {
	it("routes the anime continuity to AniDB per media kind", async () => {
		const { continuityId, read } = await seededEngine();
		const result = await read.resolveContinuity(continuityId);

		expect(result.mediaKind).toBe("anime");
		expect(metadataProviderFor(result.mediaKind)).toBe("anidb");
	});

	it("resolves each cour to its per-service member ids through the hub", async () => {
		const { continuityId, read } = await seededEngine();
		const result = await read.resolveContinuity(continuityId);

		expect(result.segments).toHaveLength(3);
		expect(result.segments[0]?.members).toStrictEqual({
			anidb: "16947",
			anilist: "140960",
			mal: "50265",
			tmdb: "120089",
		});
		expect(result.segments[2]?.members).toStrictEqual({
			anidb: "17784",
			anilist: "158927",
			mal: "53887",
			tmdb: "120089",
		});
	});

	it("orders instalment locators under the provider member title", async () => {
		const { continuityId, read } = await seededEngine();
		const ordered = await read.resolveContinuity(continuityId);
		const [first] = ordered.segments;

		expect(first?.instalments).toHaveLength(12);
		expect(first?.instalments[0]).toBe("anidb:16947#1");
		expect(first?.instalments.at(-1)).toBe("anidb:16947#12");
	});

	it("routes a TMDB film continuity to TMDB with the bare id", async () => {
		const db = await freshDb();
		const { continuityId } = await seedTmdbContinuity(db, "movie", "603");
		const result = await createEngine(db).resolveContinuity(continuityId);

		expect(result.mediaKind).toBe("film");
		expect(metadataProviderFor(result.mediaKind)).toBe("tmdb");
		expect(result.segments[0]?.members).toStrictEqual({ tmdb: "603" });
		expect(result.segments[0]?.instalments[0]).toBe("tmdb:603#1");
	});

	it("routes a TMDB series continuity to tv", async () => {
		const db = await freshDb();
		const { continuityId } = await seedTmdbContinuity(db, "tv", "1396");
		const result = await createEngine(db).resolveContinuity(continuityId);

		expect(result.mediaKind).toBe("tv");
		expect(result.segments[0]?.members).toStrictEqual({ tmdb: "1396" });
	});

	it("keeps season-0 specials out of the positional locator stream", async () => {
		const db = await freshDb();
		const { continuityId } = await seedTmdbContinuity(db, "tv", "1396", [
			"s0e1",
			"s1e1",
			"s1e2",
		]);
		const specials = await createEngine(db).resolveContinuity(continuityId);
		const [first] = specials.segments;

		expect(first?.instalments).toEqual(["tmdb:1396#1", "tmdb:1396#2"]);
	});

	it("throws for a continuity with no group", async () => {
		const read = createEngine(await freshDb());

		await expect(read.resolveContinuity("group:999")).rejects.toThrow(/no continuity/iu);
	});

	it("throws for a malformed continuity key", async () => {
		const read = createEngine(await freshDb());

		await expect(read.resolveContinuity("continuity:spy")).rejects.toThrow(/malformed/iu);
	});
});

describe("metadataProviderFor", () => {
	it("routes TV and film to TMDB", () => {
		expect(metadataProviderFor("tv")).toBe("tmdb");
		expect(metadataProviderFor("film")).toBe("tmdb");
	});
});
