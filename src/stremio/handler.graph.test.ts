import { beforeEach, describe, expect, it } from "vitest";

import {
	contentUnits,
	continuitySegments,
	continuities,
	instalmentAssertions,
	serviceInstalments,
	serviceTitles,
	titleAssertions,
	titleGroups,
} from "@/db/engine-schema";
import type { GroupSource } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import { noColdLookup, resolveMapping } from "@/engine/gateway";

import { handleStremioRequest } from "./handler.ts";
import type { AddonDeps } from "./handler.ts";

type Db = Awaited<ReturnType<typeof freshDb>>;

const one = <Row>(rows: readonly Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected an inserted row");
	}
	return row;
};

const seedGroup = async (db: Db, source: GroupSource = "t1-structure") =>
	one(await db.insert(titleGroups).values({ source }).returning().all());

const seedTitle = async (
	db: Db,
	groupId: number,
	service: string,
	serviceId: string,
) =>
	one(
		await db
			.insert(serviceTitles)
			.values({ groupId, service, serviceId })
			.returning()
			.all(),
	);

const linkTitles = async (
	db: Db,
	firstId: number,
	secondId: number,
	source: GroupSource,
) => {
	await db
		.insert(titleAssertions)
		.values({
			confidence: "high",
			source: source === "release" ? "t1-structure" : source,
			titleAId: Math.min(firstId, secondId),
			titleBId: Math.max(firstId, secondId),
		})
		.run();
};

const seedInstalment = async (db: Db, titleId: number, locator: string) =>
	one(
		await db
			.insert(serviceInstalments)
			.values({ locator, locatorKind: "position", titleId })
			.returning()
			.all(),
	);

const seedUnit = async (db: Db) =>
	one(await db.insert(contentUnits).values({}).returning().all());

const coverInstalment = async (
	db: Db,
	instalmentId: number,
	unitId: string,
) => {
	await db
		.insert(instalmentAssertions)
		.values({
			confidence: "high",
			instalmentId,
			source: "t3-episode",
			unitId,
		})
		.run();
};

const seedContinuity = async (db: Db, titleId: number) => {
	const continuity = one(
		await db
			.insert(continuities)
			.values({ source: "t1-structure" })
			.returning()
			.all(),
	);
	await db
		.insert(continuitySegments)
		.values({
			continuityId: continuity.id,
			kind: "atomic",
			releaseOrdinal: 1,
			titleId,
		})
		.run();
	return continuity.id;
};

const depsFor = (
	db: Db,
	search: AddonDeps["search"] = () => [],
): AddonDeps => ({
	resolve: async (profile, rawId) =>
		resolveMapping(db, profile, rawId, noColdLookup),
	search,
});

const get = async (
	db: Db,
	path: string,
	search: AddonDeps["search"] = () => [],
) =>
	handleStremioRequest(
		new Request(`https://mdbmap.test${path}`),
		depsFor(db, search),
	);

describe("stremio meta from the mapping graph", () => {
	let db: Db;

	beforeEach(async () => {
		db = await freshDb();
	});

	it("returns the IMDb title id as the movie video id", async () => {
		const group = await seedGroup(db);
		const source = await seedTitle(db, group.id, "tmdb", "movie:603");
		const target = await seedTitle(db, group.id, "imdb", "tt0133093");
		await linkTitles(db, source.id, target.id, "t1-structure");
		await seedContinuity(db, source.id);

		const response = await get(db, "/stremio/meta/movie/tmdb:603.json");
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			meta: { videos: [{ id: "tt0133093" }] },
		});
	});

	it("returns IMDb video ids when meta is requested with the IMDb id", async () => {
		const group = await seedGroup(db);
		const source = await seedTitle(db, group.id, "tmdb", "movie:603");
		const target = await seedTitle(db, group.id, "imdb", "tt0133093");
		await linkTitles(db, source.id, target.id, "t1-structure");
		await seedContinuity(db, source.id);

		const response = await get(db, "/stremio/meta/movie/tt0133093.json");
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			meta: { videos: [{ id: "tt0133093" }] },
		});
	});

	it("returns IMDb season-episode ids as series video ids", async () => {
		const group = await seedGroup(db);
		const source = await seedTitle(db, group.id, "tmdb", "tv:1396");
		const target = await seedTitle(db, group.id, "imdb", "tt0903747");
		await linkTitles(db, source.id, target.id, "t1-structure");
		const sourceEpisode = await seedInstalment(db, source.id, "s1e1");
		const targetEpisode = await seedInstalment(db, target.id, "s1e1");
		const unit = await seedUnit(db);
		await coverInstalment(db, sourceEpisode.id, unit.id);
		await coverInstalment(db, targetEpisode.id, unit.id);

		const response = await get(db, "/stremio/meta/series/tmdb:1396.json");
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			meta: { videos: [{ id: "tt0903747:1:1" }] },
		});

		const imdbResponse = await get(db, "/stremio/meta/series/tt0903747.json");
		expect(imdbResponse.status).toBe(200);
		await expect(imdbResponse.json()).resolves.toMatchObject({
			meta: { videos: [{ id: "tt0903747:1:1" }] },
		});
	});

	it("fills display metadata from the graph continuity id", async () => {
		const group = await seedGroup(db);
		const source = await seedTitle(db, group.id, "tmdb", "movie:603");
		const target = await seedTitle(db, group.id, "imdb", "tt0133093");
		await linkTitles(db, source.id, target.id, "t1-structure");
		const continuityId = await seedContinuity(db, source.id);
		let seen: number | undefined;
		const response = await handleStremioRequest(
			new Request("https://mdbmap.test/stremio/meta/movie/tmdb:603.json"),
			{
				...depsFor(db),
				display: (requestedId) => {
					seen = requestedId;
					return {
						backdropRef: undefined,
						cast: [],
						coverRef: "tmdb:/matrix.jpg",
						genres: ["Science Fiction"],
						ifYouLiked: [],
						nativeTitle: undefined,
						productionStatus: undefined,
						runtimeMinutes: 136,
						segments: [],
						span: "1999",
						staff: [],
						studios: [],
						synopsis: "A computer hacker learns the truth.",
						title: "The Matrix",
					};
				},
			},
		);
		expect(seen).toBe(continuityId);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			meta: {
				name: "The Matrix",
				poster: "https://image.tmdb.org/t/p/w500/matrix.jpg",
				videos: [{ id: "tt0133093" }],
			},
		});
	});
});

describe("stremio catalog from the mapping graph", () => {
	let db: Db;

	beforeEach(async () => {
		db = await freshDb();
	});

	it("returns IMDb title ids for mapped catalog search hits", async () => {
		const group = await seedGroup(db);
		const source = await seedTitle(db, group.id, "tmdb", "movie:603");
		const target = await seedTitle(db, group.id, "imdb", "tt0133093");
		await linkTitles(db, source.id, target.id, "t1-structure");
		await seedContinuity(db, source.id);

		const response = await get(
			db,
			"/stremio/catalog/movie/mdbmap.movie/search=Matrix.json",
			() => [
				{
					catalogue: {
						id: "603",
						namespace: "movie",
						service: "tmdb",
					},
					coverRef: undefined,
					mediaKind: "film",
					title: "The Matrix",
					year: 1999,
				},
			],
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			metas: [{ id: "tt0133093", name: "The Matrix" }],
		});
	});
});
