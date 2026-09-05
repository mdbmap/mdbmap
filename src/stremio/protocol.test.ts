import { ContentTypes } from "stremio-types";
import { describe, expect, it } from "vitest";

import { parseAddonPath } from "./protocol.ts";

describe("parseAddonPath", () => {
	it("reads the manifest", () => {
		expect(parseAddonPath("/stremio/manifest.json")).toEqual({
			kind: "manifest",
		});
		expect(parseAddonPath("/de/stremio/manifest.json")).toEqual({
			kind: "manifest",
		});
	});

	it("reads catalog search extra", () => {
		const parsed = parseAddonPath(
			"/stremio/catalog/movie/mdbmap.movie/search=Matrix.json",
		);
		expect(parsed).toMatchObject({
			id: "mdbmap.movie",
			kind: "catalog",
			type: ContentTypes.MOVIE,
		});
		if (parsed?.kind !== "catalog") {
			return;
		}
		expect(parsed.extra.get("search")).toBe("Matrix");
	});

	it("reads meta ids that contain colons", () => {
		expect(parseAddonPath("/stremio/meta/series/tmdb:1396.json")).toEqual({
			id: "tmdb:1396",
			kind: "meta",
			type: ContentTypes.SERIES,
		});
		expect(parseAddonPath("/stremio/meta/movie/tt0133093.json")).toEqual({
			id: "tt0133093",
			kind: "meta",
			type: ContentTypes.MOVIE,
		});
	});

	it("rejects unknown resources and types", () => {
		expect(parseAddonPath("/stremio/stream/movie/tt1.json")).toBe(undefined);
		expect(parseAddonPath("/stremio/meta/anime/anilist:1.json")).toBe(
			undefined,
		);
		expect(parseAddonPath("/movie/tmdb:603")).toBe(undefined);
	});
});
