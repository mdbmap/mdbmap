import { ContentTypes } from "stremio-types";
import { describe, expect, it } from "vitest";

import { profileFor } from "./meta.ts";

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
