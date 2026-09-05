import { ContentTypes } from "stremio-types";
import type { MetaItem } from "stremio-types";
import { describe, expect, it } from "vitest";

import type { WorkMetadata } from "@/orpc/providers";

import { applyDisplay, profileFor } from "./meta.ts";

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

const movieMeta = (): MetaItem => ({
	behaviorHints: { defaultVideoId: "tt0133093" },
	id: "tmdb:603",
	name: "tt0133093",
	type: ContentTypes.MOVIE,
	videos: [
		{
			episode: 0,
			id: "tt0133093",
			season: 0,
			title: "tt0133093",
		},
	],
});

const seriesMeta = (): MetaItem => ({
	behaviorHints: { defaultVideoId: "tt0903747:1:1" },
	id: "tmdb:1396",
	name: "tt0903747",
	type: ContentTypes.SERIES,
	videos: [
		{
			episode: 1,
			id: "tt0903747:1:1",
			season: 1,
			title: "S1E1",
		},
	],
});

describe("profileFor", () => {
	it("routes TMDB movie ids through the movie profile", () => {
		expect(profileFor(ContentTypes.MOVIE, "tmdb:603")).toBe("movie");
		expect(profileFor(ContentTypes.MOVIE, "tt0133093")).toBe("movie");
	});

	it("routes TMDB series ids through the series profile", () => {
		expect(profileFor(ContentTypes.SERIES, "tmdb:1396")).toBe("series");
	});

	it("routes anime catalogue ids through the anime profile", () => {
		expect(profileFor(ContentTypes.SERIES, "anilist:140960")).toBe("anime");
		expect(profileFor(ContentTypes.SERIES, "kitsu:44081")).toBe("anime");
		expect(profileFor(ContentTypes.MOVIE, "mal:50265")).toBe("anime");
	});
});

describe("applyDisplay", () => {
	it("fills name, poster, and synopsis from work metadata", () => {
		expect(
			applyDisplay(
				movieMeta(),
				workMeta({
					backdropRef: "tmdb:/back.jpg",
					coverRef: "tmdb:/matrix.jpg",
					genres: ["Science Fiction", "Action"],
					runtimeMinutes: 136,
					span: "1999",
					synopsis: "A computer hacker learns the truth.",
					title: "The Matrix",
				}),
			),
		).toMatchObject({
			background: "https://image.tmdb.org/t/p/w1280/back.jpg",
			description: "A computer hacker learns the truth.",
			genres: ["Science Fiction", "Action"],
			name: "The Matrix",
			poster: "https://image.tmdb.org/t/p/w500/matrix.jpg",
			releaseInfo: "1999",
			runtime: "136 min",
			videos: [{ id: "tt0133093", title: "The Matrix" }],
		});
	});

	it("overlays episode titles without changing IMDb video ids", () => {
		const meta = applyDisplay(
			seriesMeta(),
			workMeta({
				segments: [
					{
						airedFrom: "2008-01-20",
						airedTo: "2008-03-09",
						episodes: [
							{
								airDate: "2008-01-20",
								number: 1,
								title: "Pilot",
							},
						],
						label: "Season 1",
						year: 2008,
					},
				],
				title: "Breaking Bad",
			}),
		);
		expect(meta.name).toBe("Breaking Bad");
		expect(meta.videos).toEqual([
			{
				episode: 1,
				id: "tt0903747:1:1",
				released: "2008-01-20",
				season: 1,
				title: "Pilot",
			},
		]);
	});

	it("keeps the mapping name when display title is empty", () => {
		expect(applyDisplay(movieMeta(), workMeta({ title: "  " })).name).toBe(
			"tt0133093",
		);
	});
});
