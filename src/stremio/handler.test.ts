import { ContentTypes } from "stremio-types";
import { describe, expect, it } from "vitest";

import type { MappingOutcome } from "@/engine/gateway";
import type { MappingResponse } from "@/engine/serializer.ts";
import type { CatalogueSearchHit, WorkMetadata } from "@/orpc/providers";

import { CATALOG_PAGE_SIZE } from "./catalog.ts";
import { handleStremioRequest, stremioOptionsResponse } from "./handler.ts";
import type { AddonDeps } from "./handler.ts";

const movieBody: MappingResponse = {
	input: "tmdb:603",
	mappings: {
		imdb: {
			confidence: "exact",
			counterparts: [
				{
					assertionPath: [{ confidence: "high", source: "community" }],
					confidence: "exact",
					id: "tt0133093",
				},
			],
			errors: [],
			source: "t1-structure",
			status: "matched",
		},
	},
};

const seriesBody: MappingResponse = {
	input: "tmdb:1396",
	instalments: [
		{
			input: "tmdb:1396:1:1",
			mappings: {
				imdb: {
					confidence: "exact",
					counterparts: [
						{
							assertionPath: [
								{
									confidence: "high",
									source: "t3-episode",
								},
							],
							confidence: "exact",
							id: "tt0903747:1:1",
						},
					],
					errors: [],
					source: "t3-episode",
					status: "matched",
				},
			},
			source: "t3-episode",
		},
	],
	mappings: {
		imdb: {
			confidence: "exact",
			counterparts: [
				{
					assertionPath: [{ confidence: "high", source: "community" }],
					confidence: "exact",
					id: "tt0903747",
				},
			],
			errors: [],
			source: "t1-structure",
			status: "matched",
		},
	},
};

const ok = (body: MappingResponse): MappingOutcome => ({
	body,
	kind: "ok",
});

const depsOf = (
	resolve: AddonDeps["resolve"] = () => ok(movieBody),
	search: AddonDeps["search"] = () => [],
	display?: AddonDeps["display"],
): AddonDeps => ({
	resolve,
	search,
	...(display === undefined ? {} : { display }),
});

const workMeta = (overrides: Partial<WorkMetadata> = {}): WorkMetadata => ({
	backdropRef: undefined,
	cast: [],
	coverRef: undefined,
	genres: [],
	ifYouLiked: [],
	nativeTitle: undefined,
	productionStatus: undefined,
	runtimeMinutes: undefined,
	segments: [],
	span: "",
	staff: [],
	studios: [],
	synopsis: "",
	title: "Untitled",
	...overrides,
});

const filmHits = (count: number): CatalogueSearchHit[] => {
	const hits: CatalogueSearchHit[] = [];
	for (let index = 0; index < count; index += 1) {
		hits.push({
			catalogue: {
				id: String(index + 1),
				namespace: "movie",
				service: "tmdb",
			},
			coverRef: undefined,
			mediaKind: "film",
			title: `Title ${String(index + 1)}`,
			year: 1999,
		});
	}
	return hits;
};

const isCatalogPayload = (
	value: unknown,
): value is { readonly metas: readonly unknown[] } =>
	typeof value === "object" &&
	value !== null &&
	"metas" in value &&
	Array.isArray(value.metas);

const catalogMetasFrom = async (
	response: Response,
): Promise<readonly unknown[]> => {
	const payload: unknown = await response.json();
	if (!isCatalogPayload(payload)) {
		throw new Error("expected catalog metas");
	}
	return payload.metas;
};

const get = async (path: string, deps: AddonDeps = depsOf()) =>
	handleStremioRequest(new Request(`https://mdbmap.test${path}`), deps);

describe("stremio manifest and catalog", () => {
	it("serves a typed manifest with CORS", async () => {
		const response = await get("/stremio/manifest.json");
		expect(response.status).toBe(200);
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
		await expect(response.json()).resolves.toMatchObject({
			id: "community.mdbmap",
			name: "mdbmap",
		});
	});

	it("answers OPTIONS with CORS", () => {
		const response = stremioOptionsResponse();
		expect(response.status).toBe(204);
		expect(response.headers.get("access-control-allow-origin")).toBe("*");
	});

	it("returns catalog previews from search hits", async () => {
		const response = await get(
			"/stremio/catalog/movie/mdbmap.movie/search=Matrix.json",
			depsOf(
				() => ok(movieBody),
				() => [
					{
						catalogue: {
							id: "603",
							namespace: "movie",
							service: "tmdb",
						},
						coverRef: "tmdb:/matrix.jpg",
						mediaKind: "film",
						title: "The Matrix",
						year: 1999,
					},
				],
			),
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			metas: [{ id: "tt0133093" }],
		});
	});

	it("keeps catalogue ids when the hit has no IMDb mapping", async () => {
		const response = await get(
			"/stremio/catalog/movie/mdbmap.movie/search=Matrix.json",
			depsOf(
				() => ({ kind: "unknown" }),
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
			),
		);
		await expect(response.json()).resolves.toMatchObject({
			metas: [{ id: "tmdb:603" }],
		});
	});

	it("returns IMDb title ids for series catalog hits", async () => {
		const response = await get(
			"/stremio/catalog/series/mdbmap.series/search=Bad.json",
			depsOf(
				() => ok(seriesBody),
				() => [
					{
						catalogue: {
							id: "1396",
							namespace: "tv",
							service: "tmdb",
						},
						coverRef: undefined,
						mediaKind: "tv",
						title: "Breaking Bad",
						year: 2008,
					},
				],
			),
		);
		await expect(response.json()).resolves.toMatchObject({
			metas: [{ id: "tt0903747" }],
		});
	});

	it("returns IMDb title ids for anime catalog hits", async () => {
		const response = await get(
			"/stremio/catalog/series/mdbmap.anime/search=Spy.json",
			depsOf(
				() => ok(seriesBody),
				() => [
					{
						catalogue: { id: "140960", service: "anilist" },
						coverRef: undefined,
						mediaKind: "anime",
						title: "Spy x Family",
						year: 2022,
					},
				],
			),
		);
		await expect(response.json()).resolves.toMatchObject({
			metas: [{ id: "tt0903747" }],
		});
	});

	it("does not cache catalog results when search fails", async () => {
		const response = await get(
			"/stremio/catalog/movie/mdbmap.movie/search=Matrix.json",
			depsOf(
				() => ok(movieBody),
				() => {
					throw new Error("search down");
				},
			),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("public, max-age=0");
		await expect(response.json()).resolves.toMatchObject({
			cacheMaxAge: 0,
			metas: [],
		});
	});

	it("resolves at most one catalog page of search hits", async () => {
		let resolved = 0;
		const response = await get(
			"/stremio/catalog/movie/mdbmap.movie/search=Matrix.json",
			depsOf(
				() => {
					resolved += 1;
					return ok(movieBody);
				},
				() => filmHits(CATALOG_PAGE_SIZE + 5),
			),
		);
		expect(resolved).toBe(CATALOG_PAGE_SIZE);
		await expect(catalogMetasFrom(response)).resolves.toHaveLength(
			CATALOG_PAGE_SIZE,
		);
	});
});

describe("stremio meta video ids", () => {
	it("returns IMDb video ids for a movie meta request", async () => {
		const response = await get("/stremio/meta/movie/tmdb:603.json");
		await expect(response.json()).resolves.toMatchObject({
			meta: {
				behaviorHints: { defaultVideoId: "tt0133093" },
				videos: [{ id: "tt0133093" }],
			},
		});
	});

	it("returns IMDb episode video ids for a series meta request", async () => {
		const response = await get(
			"/stremio/meta/series/tmdb:1396.json",
			depsOf(() => ok(seriesBody)),
		);
		await expect(response.json()).resolves.toMatchObject({
			meta: {
				type: ContentTypes.SERIES,
				videos: [{ id: "tt0903747:1:1" }],
			},
		});
	});

	it("returns IMDb video ids for an anime catalogue id", async () => {
		const response = await get(
			"/stremio/meta/series/anilist:140960.json",
			depsOf(() =>
				ok({
					...seriesBody,
					input: "anilist:140960",
					instalments: [
						{
							input: "anilist:140960:1",
							mappings: seriesBody.instalments?.[0]?.mappings ?? {},
							source: "t3-episode",
						},
					],
				}),
			),
		);
		await expect(response.json()).resolves.toMatchObject({
			meta: { videos: [{ id: "tt0903747:1:1" }] },
		});
	});

	it("returns IMDb video ids when meta is requested with an IMDb id", async () => {
		const response = await get(
			"/stremio/meta/movie/tt0133093.json",
			depsOf(() =>
				ok({
					input: "tt0133093",
					mappings: {},
				}),
			),
		);
		await expect(response.json()).resolves.toMatchObject({
			meta: {
				behaviorHints: { defaultVideoId: "tt0133093" },
				videos: [{ id: "tt0133093" }],
			},
		});
	});

	it("404s unknown ids", async () => {
		const response = await get(
			"/stremio/meta/movie/tmdb:999.json",
			depsOf(() => ({ kind: "unknown" })),
		);
		expect(response.status).toBe(404);
	});
});

describe("stremio meta display metadata", () => {
	it("overlays work metadata onto IMDb video ids", async () => {
		let seen: number | undefined;
		const response = await get(
			"/stremio/meta/movie/tmdb:603.json",
			depsOf(
				() => ok({ ...movieBody, continuityId: 42 }),
				() => [],
				(continuityId) => {
					seen = continuityId;
					return workMeta({
						backdropRef: "tmdb:/back.jpg",
						coverRef: "tmdb:/matrix.jpg",
						genres: ["Science Fiction", "Action"],
						runtimeMinutes: 136,
						span: "1999",
						synopsis: "A computer hacker learns the truth.",
						title: "The Matrix",
					});
				},
			),
		);
		expect(seen).toBe(42);
		await expect(response.json()).resolves.toMatchObject({
			meta: {
				description: "A computer hacker learns the truth.",
				name: "The Matrix",
				poster: "https://image.tmdb.org/t/p/w500/matrix.jpg",
				videos: [{ id: "tt0133093", title: "The Matrix" }],
			},
		});
	});

	it("does not fetch display when the mapping has no continuity", async () => {
		let called = 0;
		const response = await get(
			"/stremio/meta/movie/tmdb:603.json",
			depsOf(
				() => ok(movieBody),
				() => [],
				() => {
					called += 1;
					return workMeta({ title: "The Matrix" });
				},
			),
		);
		expect(called).toBe(0);
		await expect(response.json()).resolves.toMatchObject({
			meta: { name: "tt0133093", videos: [{ id: "tt0133093" }] },
		});
	});

	it("keeps IMDb videos when display throws", async () => {
		const response = await get(
			"/stremio/meta/movie/tmdb:603.json",
			depsOf(
				() => ok({ ...movieBody, continuityId: 42 }),
				() => [],
				() => {
					throw new Error("tmdb down");
				},
			),
		);
		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			meta: {
				name: "tt0133093",
				videos: [{ id: "tt0133093" }],
			},
		});
	});
});
