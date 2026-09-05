import { ContentTypes } from "stremio-types";
import { describe, expect, it } from "vitest";

import type { MappingOutcome } from "@/engine/gateway";
import type { MappingResponse } from "@/engine/serializer.ts";

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
): AddonDeps => ({ resolve, search });

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
			metas: [{ id: "tmdb:603" }],
		});
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

	it("404s unknown ids", async () => {
		const response = await get(
			"/stremio/meta/movie/tmdb:999.json",
			depsOf(() => ({ kind: "unknown" })),
		);
		expect(response.status).toBe(404);
	});
});
