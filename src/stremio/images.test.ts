import { describe, expect, it } from "vitest";

import { backgroundUrl, posterUrl } from "./images.ts";

describe("posterUrl", () => {
	it("turns TMDB refs into w500 image URLs", () => {
		expect(posterUrl("tmdb:/matrix.jpg")).toBe(
			"https://image.tmdb.org/t/p/w500/matrix.jpg",
		);
		expect(posterUrl("tmdb:matrix.jpg")).toBe(
			"https://image.tmdb.org/t/p/w500/matrix.jpg",
		);
	});

	it("passes through absolute http URLs", () => {
		expect(posterUrl("https://img.example/cover.jpg")).toBe(
			"https://img.example/cover.jpg",
		);
	});

	it("drops snapshot refs that are not TMDB or http", () => {
		expect(posterUrl("anidb:270350.jpg")).toBeUndefined();
		expect(posterUrl("")).toBeUndefined();
		expect(posterUrl(undefined)).toBeUndefined();
	});
});

describe("backgroundUrl", () => {
	it("turns TMDB refs into w1280 image URLs", () => {
		expect(backgroundUrl("tmdb:/back.jpg")).toBe(
			"https://image.tmdb.org/t/p/w1280/back.jpg",
		);
	});
});
