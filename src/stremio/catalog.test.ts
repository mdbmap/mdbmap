import { ContentTypes } from "stremio-types";
import { describe, expect, it } from "vitest";

import type { CatalogueSearchHit } from "@/orpc/providers";

import {
	catalogPreviews,
	CATALOG_PAGE_SIZE,
	pageHits,
	previewsFromHits,
} from "./catalog.ts";

describe("previewsFromHits", () => {
	it("keeps catalogue ids and turns TMDB cover refs into poster URLs", () => {
		const [preview] = previewsFromHits(
			[
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
			ContentTypes.MOVIE,
		);
		expect(preview).toEqual({
			id: "tmdb:603",
			name: "The Matrix",
			poster: "https://image.tmdb.org/t/p/w500/matrix.jpg",
			releaseInfo: "1999",
			type: ContentTypes.MOVIE,
		});
	});

	it("types anime catalogue hits as series with AniList ids", () => {
		const [preview] = previewsFromHits(
			[
				{
					catalogue: { id: "140960", service: "anilist" },
					coverRef: "https://img.example/cover.jpg",
					mediaKind: "anime",
					title: "Spy x Family",
					year: 2022,
				},
			],
			ContentTypes.SERIES,
		);
		expect(preview?.id).toBe("anilist:140960");
		expect(preview?.type).toBe(ContentTypes.SERIES);
		expect(preview?.poster).toBe("https://img.example/cover.jpg");
	});
});

describe("catalogPreviews", () => {
	const matrixHit = {
		catalogue: {
			id: "603",
			namespace: "movie" as const,
			service: "tmdb" as const,
		},
		coverRef: "tmdb:/matrix.jpg",
		mediaKind: "film" as const,
		title: "The Matrix",
		year: 1999,
	};

	it("rewrites mapped hits to IMDb title ids", async () => {
		const [preview] = await catalogPreviews(
			[matrixHit],
			ContentTypes.MOVIE,
			"film",
			() => ({
				body: {
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
				},
				kind: "ok",
			}),
		);
		expect(preview?.id).toBe("tt0133093");
		expect(preview?.name).toBe("The Matrix");
	});

	it("keeps catalogue ids when no IMDb mapping exists", async () => {
		const [preview] = await catalogPreviews(
			[matrixHit],
			ContentTypes.MOVIE,
			"film",
			() => ({ kind: "unknown" }),
		);
		expect(preview?.id).toBe("tmdb:603");
	});

	it("uses the IMDb title id, not an episode video id", async () => {
		const [preview] = await catalogPreviews(
			[
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
			ContentTypes.SERIES,
			"tv",
			() => ({
				body: {
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
					mappings: {},
				},
				kind: "ok",
			}),
		);
		expect(preview?.id).toBe("tt0903747");
	});
});

describe("pageHits", () => {
	const hits: CatalogueSearchHit[] = [];
	for (let index = 0; index < CATALOG_PAGE_SIZE + 5; index += 1) {
		hits.push({
			catalogue: {
				id: String(index + 1),
				namespace: "movie" as const,
				service: "tmdb" as const,
			},
			coverRef: undefined,
			mediaKind: "film" as const,
			title: `Title ${String(index + 1)}`,
			year: 1999,
		});
	}

	it("keeps one page of hits", () => {
		expect(pageHits(hits, new URLSearchParams())).toHaveLength(
			CATALOG_PAGE_SIZE,
		);
	});

	it("applies skip before the page bound", () => {
		expect(pageHits(hits, new URLSearchParams("skip=20"))).toHaveLength(5);
	});
});
