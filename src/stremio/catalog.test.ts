import { ContentTypes } from "stremio-types";
import { describe, expect, it } from "vitest";

import { previewsFromHits } from "./catalog.ts";

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
