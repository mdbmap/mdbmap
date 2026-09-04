import { describe, expect, it, vi } from "vitest";

import { createTmdbCatalogueSearch } from "./catalogue-search-tmdb.ts";

const urlOf = (input: RequestInfo | URL): string => {
	if (typeof input === "string") {
		return input;
	}
	return input instanceof URL ? input.href : input.url;
};

const movieResults = {
	results: [
		{
			id: 603,
			poster_path: "/matrix.jpg",
			release_date: "1999-03-31",
			title: "The Matrix",
		},
		{
			id: 604,
			poster_path: "/reloaded.jpg",
			release_date: "2003-05-15",
			title: "The Matrix Reloaded",
		},
	],
};

const tvResults = {
	results: [
		{
			first_air_date: "2008-01-20",
			id: 1396,
			name: "Breaking Bad",
			poster_path: "/bb.jpg",
		},
	],
};

const multiResults = {
	results: [
		{
			id: 603,
			media_type: "movie",
			poster_path: "/matrix.jpg",
			release_date: "1999-03-31",
			title: "The Matrix",
		},
		{ id: 1, media_type: "person", name: "Someone" },
		{
			first_air_date: "2008-01-20",
			id: 1396,
			media_type: "tv",
			name: "Breaking Bad",
			poster_path: "/bb.jpg",
		},
	],
};

const jsonFetch = (body: unknown) =>
	vi.fn(async (_input: RequestInfo | URL): Promise<Response> => {
		await Promise.resolve();
		return Response.json(body);
	});

describe("tmdb catalogue search movie", () => {
	it("maps movie hits to catalogue identity", async () => {
		const fetchFn = vi.fn(
			async (input: RequestInfo | URL): Promise<Response> => {
				await Promise.resolve();
				expect(urlOf(input)).toContain("/search/movie?");
				expect(urlOf(input)).toContain("query=matrix");
				expect(urlOf(input)).toContain("api_key=test-key");
				return Response.json(movieResults);
			},
		);
		const search = createTmdbCatalogueSearch({
			apiKey: "test-key",
			fetchFn,
		});

		await expect(search.search("matrix", "movie")).resolves.toEqual([
			{
				catalogue: { id: "603", namespace: "movie", service: "tmdb" },
				coverRef: "tmdb:/matrix.jpg",
				mediaKind: "film",
				title: "The Matrix",
				year: 1999,
			},
			{
				catalogue: { id: "604", namespace: "movie", service: "tmdb" },
				coverRef: "tmdb:/reloaded.jpg",
				mediaKind: "film",
				title: "The Matrix Reloaded",
				year: 2003,
			},
		]);
	});
});

describe("tmdb catalogue search tv", () => {
	it("maps tv hits to catalogue identity", async () => {
		const fetchFn = vi.fn(
			async (input: RequestInfo | URL): Promise<Response> => {
				await Promise.resolve();
				expect(urlOf(input)).toContain("/search/tv?");
				return Response.json(tvResults);
			},
		);
		const search = createTmdbCatalogueSearch({
			apiKey: "test-key",
			fetchFn,
		});

		await expect(search.search("breaking", "tv")).resolves.toEqual([
			{
				catalogue: { id: "1396", namespace: "tv", service: "tmdb" },
				coverRef: "tmdb:/bb.jpg",
				mediaKind: "tv",
				title: "Breaking Bad",
				year: 2008,
			},
		]);
	});
});

describe("tmdb catalogue search multi", () => {
	it("filters people and preserves provider order", async () => {
		const search = createTmdbCatalogueSearch({
			apiKey: "test-key",
			fetchFn: jsonFetch(multiResults),
			limit: 20,
		});

		const hits = await search.search("matrix", "multi");
		expect(hits.map((item) => item.catalogue)).toEqual([
			{ id: "603", namespace: "movie", service: "tmdb" },
			{ id: "1396", namespace: "tv", service: "tmdb" },
		]);
	});

	it("caps results at the configured limit", async () => {
		const search = createTmdbCatalogueSearch({
			apiKey: "test-key",
			fetchFn: jsonFetch(movieResults),
			limit: 1,
		});

		const hits = await search.search("matrix", "movie");
		expect(hits).toHaveLength(1);
		expect(hits[0]?.catalogue.id).toBe("603");
	});

	it("throws when the API key is missing", async () => {
		const search = createTmdbCatalogueSearch({
			apiKey: undefined,
			fetchFn: vi.fn(async (_input: RequestInfo | URL): Promise<Response> => {
				await Promise.resolve();
				return Response.json({});
			}),
		});
		await expect(search.search("matrix", "movie")).rejects.toThrow(
			"TMDB_API_KEY is not configured",
		);
	});
});
