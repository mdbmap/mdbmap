import { describe, expect, it } from "vitest";

import { titleAssertions, titleGroups } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";

import { createEngine } from "./engine.ts";
import { metadataProviderFor } from "./seam.ts";
import {
	seedCrossGroupContinuity,
	seedMadokaMagica,
	seedMadeInAbyss,
	seedMonogatari,
	seedSpyXFamily,
	seedTmdbContinuity,
} from "./test-continuity.ts";

const seededEngine = async () => {
	const db = await freshDb();
	const { continuityId } = await seedSpyXFamily(db);
	return { continuityId, read: createEngine(db) };
};

const assertGroupAliases = async (
	db: Awaited<ReturnType<typeof freshDb>>,
	continuityId: string,
	groupIds: readonly number[],
) => {
	const engine = createEngine(db);
	const aliases = await Promise.all(
		groupIds.map(async (groupId) =>
			engine.resolveContinuity(`group:${groupId}`),
		),
	);
	expect(aliases.map((via) => via.continuityId)).toEqual(
		groupIds.map(() => continuityId),
	);
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
		expect(result.segments.map((segment) => segment.kind)).toEqual([
			"episodic",
			"episodic",
			"episodic",
		]);
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
		expect(result.segments[0]?.kind).toBe("atomic");
		expect(result.segments[0]?.members).toStrictEqual({ tmdb: "603" });
		expect(result.segments[0]?.instalments).toEqual(["tmdb:603#1"]);
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

	it("walks a multi-group continuity as episodic then one atomic film locator", async () => {
		const db = await freshDb();
		const { continuityId, filmGroupId, seriesGroupId } =
			await seedCrossGroupContinuity(db);
		const result = await createEngine(db).resolveContinuity(continuityId);
		const [series, film] = result.segments;

		expect(result.mediaKind).toBe("anime");
		expect(result.segments).toHaveLength(2);
		expect(series?.kind).toBe("episodic");
		expect(series?.instalments).toEqual(["anidb:1001#1", "anidb:1001#2"]);
		expect(series?.members).toStrictEqual({
			anidb: "1001",
			mal: "2001",
			tmdb: "3001",
		});
		expect(film?.kind).toBe("atomic");
		expect(film?.instalments).toEqual(["anidb:1002#1"]);
		expect(film?.members).toStrictEqual({
			anidb: "1002",
			mal: "2002",
			tmdb: "3002",
		});
		expect(await db.select().from(titleGroups).all()).toHaveLength(2);
		expect(await db.select().from(titleAssertions).all()).toHaveLength(0);
		const viaSeries = await createEngine(db).resolveContinuity(
			`group:${seriesGroupId}`,
		);
		const viaFilm = await createEngine(db).resolveContinuity(
			`group:${filmGroupId}`,
		);
		expect(viaSeries.continuityId).toBe(result.continuityId);
		expect(viaFilm.continuityId).toBe(result.continuityId);
	});

	it("Made in Abyss release order is cour, Dawn of the Deep Soul, then cour", async () => {
		const db = await freshDb();
		const seeded = await seedMadeInAbyss(db);
		const result = await createEngine(db).resolveContinuity(
			seeded.continuityId,
		);
		const [courOne, film, courTwo] = result.segments;

		expect(result.segments).toHaveLength(3);
		expect(result.segments.map((segment) => segment.kind)).toEqual([
			"episodic",
			"atomic",
			"episodic",
		]);
		expect(courOne?.instalments).toEqual(["anidb:9001#1", "anidb:9001#2"]);
		expect(film?.instalments).toEqual(["anidb:9002#1"]);
		expect(courTwo?.instalments).toEqual(["anidb:9003#1", "anidb:9003#2"]);
		expect(courOne?.members.anidb).toBe("9001");
		expect(film?.members.anidb).toBe("9002");
		expect(courTwo?.members.anidb).toBe("9003");
		expect(seeded.groupIds).toHaveLength(2);
		expect(new Set(seeded.groupIds).size).toBe(2);
		expect(await db.select().from(titleAssertions).all()).toHaveLength(0);
		await assertGroupAliases(db, result.continuityId, seeded.groupIds);
	});

	it("Madoka Magica keeps Rebellion atomic and outside the TV group", async () => {
		const db = await freshDb();
		const seeded = await seedMadokaMagica(db);
		const result = await createEngine(db).resolveContinuity(
			seeded.continuityId,
		);
		const [series, rebellion] = result.segments;

		expect(result.segments.map((segment) => segment.kind)).toEqual([
			"episodic",
			"atomic",
		]);
		expect(series?.instalments).toEqual(["anidb:9101#1", "anidb:9101#2"]);
		expect(rebellion?.instalments).toEqual(["anidb:9102#1"]);
		expect(series?.members.anidb).toBe("9101");
		expect(rebellion?.members.anidb).toBe("9102");
		expect(seeded.groupIds).toHaveLength(2);
		expect(new Set(seeded.groupIds).size).toBe(2);
		expect(await db.select().from(titleAssertions).all()).toHaveLength(0);
		await assertGroupAliases(db, result.continuityId, seeded.groupIds);
	});

	it("Monogatari resolve stays Bake, Nise, Kizu in release order", async () => {
		const db = await freshDb();
		const seeded = await seedMonogatari(db);
		const result = await createEngine(db).resolveContinuity(
			seeded.continuityId,
		);

		expect(result.segments.map((segment) => segment.kind)).toEqual([
			"episodic",
			"episodic",
			"atomic",
		]);
		expect(result.segments.map((segment) => segment.members.anidb)).toEqual([
			"9201",
			"9202",
			"9203",
		]);
		expect(result.segments[0]?.instalments).toEqual([
			"anidb:9201#1",
			"anidb:9201#2",
		]);
		expect(result.segments[1]?.instalments).toEqual([
			"anidb:9202#1",
			"anidb:9202#2",
		]);
		expect(result.segments[2]?.instalments).toEqual(["anidb:9203#1"]);
		expect(seeded.groupIds).toHaveLength(3);
		expect(new Set(seeded.groupIds).size).toBe(3);
		expect(await db.select().from(titleAssertions).all()).toHaveLength(0);
		await assertGroupAliases(db, result.continuityId, seeded.groupIds);
	});

	it("throws for a continuity with no group", async () => {
		const read = createEngine(await freshDb());

		await expect(read.resolveContinuity("group:999")).rejects.toThrow(
			/no continuity/iu,
		);
	});

	it("throws for an unknown continuity id", async () => {
		const read = createEngine(await freshDb());

		await expect(read.resolveContinuity("continuity:999")).rejects.toThrow(
			/no continuity/iu,
		);
	});

	it("throws for a malformed continuity key", async () => {
		const read = createEngine(await freshDb());

		await expect(read.resolveContinuity("continuity:spy")).rejects.toThrow(
			/malformed/iu,
		);
	});
});

describe("metadataProviderFor", () => {
	it("routes TV and film to TMDB", () => {
		expect(metadataProviderFor("tv")).toBe("tmdb");
		expect(metadataProviderFor("film")).toBe("tmdb");
	});
});
