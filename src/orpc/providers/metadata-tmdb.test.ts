import { describe, expect, it, vi } from "vitest";

import type { ResolveResult } from "@/engine";

import { createMemoryMetadataStore } from "./metadata-store.ts";
import type { MetadataStore } from "./metadata-store.ts";
import { MOVIE_APPEND, TV_APPEND } from "./metadata-tmdb-parse.ts";
import { createTmdbProvider } from "./metadata-tmdb.ts";

const SERIES_ID = "999";
const MOVIE_ID = SERIES_ID;
const TMDB_BASE = "https://api.themoviedb.org/3";
const movieUrl = (id: string) =>
	`${TMDB_BASE}/movie/${id}?append_to_response=${MOVIE_APPEND}&api_key=test-key`;
const tvUrl = (id: string) =>
	`${TMDB_BASE}/tv/${id}?append_to_response=${TV_APPEND}&api_key=test-key`;
const seasonUrl = (id: string, season: number) =>
	`${TMDB_BASE}/tv/${id}/season/${season}?api_key=test-key`;

const resolved: ResolveResult = {
	continuityId: "continuity:1",
	mediaKind: "tv",
	segments: [
		{
			instalments: ["tmdb:999#1", "tmdb:999#2"],
			kind: "episodic",
			members: { tmdb: SERIES_ID },
		},
		{
			instalments: ["tmdb:999#3"],
			kind: "episodic",
			members: { tmdb: SERIES_ID },
		},
	],
};

const seriesJson = {
	aggregate_credits: {
		cast: [
			{ id: 1, name: "Lead Actor", roles: [{ character: "Hero" }] },
			{ id: 2, name: "Support Actor", roles: [{ character: "Sidekick" }] },
		],
		crew: [
			{
				department: "Directing",
				id: 3,
				job: "Director",
				name: "Jane Director",
			},
			{
				department: "Sound",
				id: 4,
				job: "Original Music Composer",
				name: "Sam Score",
			},
			{ department: "Editing", id: 5, job: "Editor", name: "Ignored Editor" },
		],
	},
	backdrop_path: "/backdrop.jpg",
	created_by: [{ id: 9, name: "Orig Creator" }],
	episode_run_time: [45, 50],
	first_air_date: "2020-04-01",
	genres: [
		{ name: "Drama" },
		{ name: "  " },
		{ name: "Drama" },
		{ name: "Comedy" },
	],
	last_air_date: "2021-06-30",
	name: "Test Show",
	original_name: "テストショー",
	overview: "A show used for tests.",
	poster_path: "/poster.jpg",
	production_companies: [{ name: "Studio A" }, { name: "Studio B" }],
	recommendations: {
		results: [{ id: 77, name: "Similar Show", poster_path: "/similar.jpg" }],
	},
	seasons: [
		{ air_date: "2019-12-01", name: "Specials", season_number: 0 },
		{ air_date: "2020-04-01", name: "Season 1", season_number: 1 },
		{ air_date: "2021-04-01", name: "Season 2", season_number: 2 },
	],
	status: " Returning Series ",
	tagline: "What if",
	translations: {
		translations: [
			{
				data: { name: "Test Show", overview: "A show used for tests." },
				iso_639_1: "en",
			},
			{
				data: { name: "Testshow", overview: "Eine Testserie." },
				iso_639_1: "de",
			},
		],
	},
};

const season1Json = {
	air_date: "2020-04-01",
	episodes: [
		{ air_date: "2020-04-01", episode_number: 1, name: "Pilot" },
		{ air_date: "2020-04-08", episode_number: 2, name: "Second" },
	],
};

const season2Json = {
	air_date: "2021-04-01",
	episodes: [{ air_date: "2021-04-01", episode_number: 1, name: "Return" }],
};

const movieJson = {
	backdrop_path: "/movie-backdrop.jpg",
	credits: {
		cast: [{ character: "Hero", id: 11, name: "Movie Lead" }],
		crew: [{ id: 12, job: "Director", name: "Movie Director" }],
	},
	genres: [{ name: "Action" }, { name: "" }, { name: "Science Fiction" }],
	original_title: "映画",
	overview: "A movie used for tests.",
	poster_path: "/movie-poster.jpg",
	production_companies: [{ name: "Movie Studio" }],
	recommendations: {
		results: [
			{ id: 604, poster_path: "/similar-movie.jpg", title: "Similar Movie" },
		],
	},
	release_date: "2001-05-16",
	runtime: 121,
	status: "Released",
	title: "Test Movie",
};

const movieResolved: ResolveResult = {
	continuityId: "continuity:movie",
	mediaKind: "film",
	segments: [
		{
			instalments: ["tmdb:999"],
			kind: "atomic",
			members: { tmdb: MOVIE_ID },
		},
	],
};

const mixedResolved: ResolveResult = {
	continuityId: "continuity:mixed",
	mediaKind: "tv",
	segments: [
		{
			instalments: ["tmdb:999#1"],
			kind: "episodic",
			members: { tmdb: SERIES_ID },
		},
		{
			instalments: ["tmdb:999"],
			kind: "atomic",
			members: { tmdb: MOVIE_ID },
		},
	],
};

const urlOf = (input: RequestInfo | URL): string => {
	if (typeof input === "string") {
		return input;
	}
	return input instanceof URL ? input.href : input.url;
};

const SECOND_SERIES_ID = "200";
const SECOND_MOVIE_ID = "1000";

const secondMovieJson = {
	...movieJson,
	genres: [{ name: "Adventure" }, { name: "Action" }],
	release_date: "2003-11-05",
	runtime: 140,
	title: "Test Movie Two",
};

const multiMovieResolved: ResolveResult = {
	continuityId: "continuity:multi-movie",
	mediaKind: "film",
	segments: [
		{
			instalments: ["tmdb:999"],
			kind: "atomic",
			members: { tmdb: MOVIE_ID },
		},
		{
			instalments: ["tmdb:1000"],
			kind: "atomic",
			members: { tmdb: SECOND_MOVIE_ID },
		},
	],
};

const noTmdbResolved: ResolveResult = {
	continuityId: "continuity:imdb-only",
	mediaKind: "film",
	segments: [
		{
			instalments: ["imdb:tt1"],
			kind: "atomic",
			members: {},
		},
	],
};

const secondSeriesJson = {
	...seriesJson,
	name: "Other Show",
	seasons: [
		{ air_date: "2019-12-01", name: "Specials", season_number: 0 },
		{ air_date: "2022-04-01", name: "Season 1", season_number: 1 },
	],
};

const multiTvResolved: ResolveResult = {
	continuityId: "continuity:multi-tv",
	mediaKind: "tv",
	segments: [
		{
			instalments: ["tmdb:999#1"],
			kind: "episodic",
			members: { tmdb: SERIES_ID },
		},
		{
			instalments: ["tmdb:200#1"],
			kind: "episodic",
			members: { tmdb: SECOND_SERIES_ID },
		},
	],
};

const responseFor = (url: string): Response => {
	if (url.includes("/season/1")) {
		return Response.json(season1Json);
	}
	if (url.includes("/season/2")) {
		return Response.json(season2Json);
	}
	if (url.includes(`/movie/${SECOND_MOVIE_ID}`)) {
		return Response.json(secondMovieJson);
	}
	if (url.includes(`/movie/${MOVIE_ID}`)) {
		return Response.json(movieJson);
	}
	if (url.includes(`/tv/${SECOND_SERIES_ID}`)) {
		return Response.json(secondSeriesJson);
	}
	if (url.includes(`/tv/${SERIES_ID}`)) {
		return Response.json(seriesJson);
	}
	return Response.json({ error: "not found" }, { status: 404 });
};

const makeFetch = () =>
	vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
		await Promise.resolve();
		return responseFor(urlOf(input));
	});

const makeStore = (): MetadataStore => createMemoryMetadataStore();

const makeProvider = (
	fetchFn: typeof fetch,
	store: MetadataStore = makeStore(),
) =>
	createTmdbProvider({
		apiKey: "test-key",
		fetchFn,
		resolveStore: () => store,
	});

describe("tmdb metadata provider", () => {
	it("normalises a series into WorkMetadata aligned with the engine segments", async () => {
		const fetchFn = makeFetch();
		const provider = makeProvider(fetchFn);

		const meta = await provider.fetchWork(resolved);

		expect(meta.title).toBe("Test Show");
		expect(meta.nativeTitle).toBe("テストショー");
		expect(meta.synopsis).toBe("A show used for tests.");
		expect(meta.backdropRef).toBe("tmdb:/backdrop.jpg");
		expect(meta.coverRef).toBe("tmdb:/poster.jpg");
		expect(meta.span).toBe("2020–2021");
		expect(meta.studios).toStrictEqual(["Studio A", "Studio B"]);
		expect(meta.genres).toStrictEqual(["Drama", "Comedy"]);
		expect(meta.runtimeMinutes).toBe(45);
		expect(meta.productionStatus).toBe("Returning Series");

		expect(meta.cast).toStrictEqual([
			{ name: "Lead Actor", ref: "tmdb:person:1", role: "Hero" },
			{ name: "Support Actor", ref: "tmdb:person:2", role: "Sidekick" },
		]);
		expect(meta.staff).toStrictEqual([
			{ name: "Orig Creator", ref: "tmdb:person:9", role: "Original Creator" },
			{ name: "Jane Director", ref: "tmdb:person:3", role: "Director" },
			{ name: "Sam Score", ref: "tmdb:person:4", role: "Music" },
		]);
		expect(meta.ifYouLiked).toStrictEqual([
			{
				continuityId: "tmdb:tv:77",
				coverRef: "tmdb:/similar.jpg",
				title: "Similar Show",
			},
		]);

		expect(meta.segments).toHaveLength(2);
		expect(meta.segments[0]?.label).toBe("Season 1");
		expect(meta.segments[0]?.year).toBe(2020);
		expect(meta.segments[0]?.airedFrom).toBe("2020-04-01");
		expect(meta.segments[0]?.airedTo).toBe("2020-04-08");
		expect(meta.segments[0]?.episodes).toStrictEqual([
			{ airDate: "2020-04-01", number: 1, title: "Pilot" },
			{ airDate: "2020-04-08", number: 2, title: "Second" },
		]);
		expect(meta.segments[1]?.label).toBe("Season 2");
		expect(meta.segments[1]?.episodes).toHaveLength(1);
	});

	it("persists one catalogue document per TMDB title", async () => {
		const fetchFn = makeFetch();
		const store = makeStore();
		const provider = makeProvider(fetchFn, store);

		await provider.fetchWork(resolved);

		expect(await store.get("tmdb", `tv:${SERIES_ID}`)).toBeDefined();
		expect(await store.get("tmdb", `movie:${SERIES_ID}`)).toBeUndefined();
	});

	it("serves a snapshot hit with zero upstream subrequests", async () => {
		const fetchFn = makeFetch();
		const provider = makeProvider(fetchFn);

		const first = await provider.fetchWork(resolved);
		const callsAfterMiss = fetchFn.mock.calls.length;
		expect(callsAfterMiss).toBe(3);

		const second = await provider.fetchWork(resolved);
		expect(fetchFn.mock.calls.length).toBe(callsAfterMiss);
		expect(second).toStrictEqual(first);
	});

	it("fetches and normalises movie metadata", async () => {
		const fetchFn = makeFetch();
		const provider = makeProvider(fetchFn);

		const meta = await provider.fetchWork(movieResolved);

		expect(fetchFn).toHaveBeenCalledWith(movieUrl("999"));
		expect(meta).toMatchObject({
			backdropRef: "tmdb:/movie-backdrop.jpg",
			coverRef: "tmdb:/movie-poster.jpg",
			genres: ["Action", "Science Fiction"],
			nativeTitle: "映画",
			productionStatus: "Released",
			runtimeMinutes: 121,
			studios: ["Movie Studio"],
			synopsis: "A movie used for tests.",
			title: "Test Movie",
		});
		expect(meta.cast).toStrictEqual([
			{ name: "Movie Lead", ref: "tmdb:person:11", role: "Hero" },
		]);
		expect(meta.staff).toStrictEqual([
			{ name: "Movie Director", ref: "tmdb:person:12", role: "Director" },
		]);
		expect(meta.ifYouLiked).toStrictEqual([
			{
				continuityId: "tmdb:movie:604",
				coverRef: "tmdb:/similar-movie.jpg",
				title: "Similar Movie",
			},
		]);
		expect(meta.segments).toStrictEqual([
			{
				airedFrom: "2001-05-16",
				airedTo: "2001-05-16",
				episodes: [],
				label: "Test Movie",
				year: 2001,
			},
		]);
		expect(meta.span).toBe("2001");
	});

	it("fetches mixed continuities by contiguous segment kind", async () => {
		const fetchFn = makeFetch();
		const provider = makeProvider(fetchFn);

		const meta = await provider.fetchWork(mixedResolved);

		expect(fetchFn.mock.calls.map(([input]) => urlOf(input))).toEqual(
			expect.arrayContaining([
				tvUrl("999"),
				seasonUrl("999", 1),
				movieUrl("999"),
			]),
		);
		expect(meta.title).toBe("Test Show");
		expect(meta.segments).toStrictEqual([
			expect.objectContaining({ label: "Season 1", year: 2020 }),
			expect.objectContaining({ label: "Test Movie", year: 2001 }),
		]);
	});

	it("isolates movie and TV snapshots with the same numeric ID", async () => {
		const fetchFn = makeFetch();
		const store = makeStore();
		const provider = makeProvider(fetchFn, store);

		const movieMeta = await provider.fetchWork(movieResolved);
		const tvMeta = await provider.fetchWork(resolved);

		expect(await store.get("tmdb", "movie:999")).toBeDefined();
		expect(await store.get("tmdb", "tv:999")).toBeDefined();
		expect(movieMeta.title).toBe("Test Movie");
		expect(tvMeta.title).toBe("Test Show");
		expect(fetchFn).toHaveBeenCalledTimes(4);
		expect(fetchFn.mock.calls.map(([input]) => urlOf(input))).toStrictEqual([
			movieUrl("999"),
			tvUrl("999"),
			seasonUrl("999", 1),
			seasonUrl("999", 2),
		]);
	});

	it("fetches movie metadata for an atomic segment in a mixed continuity", async () => {
		const fetchFn = makeFetch();
		const provider = makeProvider(fetchFn);

		const meta = await provider.fetchWork(mixedResolved);

		expect(meta.segments).toStrictEqual([
			{
				airedFrom: "2020-04-01",
				airedTo: "2020-04-08",
				episodes: [
					{ airDate: "2020-04-01", number: 1, title: "Pilot" },
					{ airDate: "2020-04-08", number: 2, title: "Second" },
				],
				label: "Season 1",
				year: 2020,
			},
			{
				airedFrom: "2001-05-16",
				airedTo: "2001-05-16",
				episodes: [],
				label: "Test Movie",
				year: 2001,
			},
		]);
		expect(fetchFn.mock.calls.map(([input]) => urlOf(input))).toEqual(
			expect.arrayContaining([
				tvUrl("999"),
				seasonUrl("999", 1),
				movieUrl("999"),
			]),
		);
	});

	it("fetches each distinct TV id in its own run", async () => {
		const fetchFn = makeFetch();
		const provider = makeProvider(fetchFn);

		const meta = await provider.fetchWork(multiTvResolved);

		expect(fetchFn.mock.calls.map(([input]) => urlOf(input))).toEqual(
			expect.arrayContaining([
				tvUrl("999"),
				seasonUrl("999", 1),
				tvUrl("200"),
				seasonUrl("200", 1),
			]),
		);
		expect(meta.segments).toStrictEqual([
			expect.objectContaining({ label: "Season 1", year: 2020 }),
			expect.objectContaining({ label: "Season 1", year: 2022 }),
		]);
	});

	it("reuses one series document across different continuity slices", async () => {
		const fetchFn = makeFetch();
		const store = makeStore();
		const provider = makeProvider(fetchFn, store);
		const [firstSegment] = resolved.segments;
		if (firstSegment === undefined) {
			throw new Error("expected a TV segment fixture");
		}
		const oneSegmentResolved: ResolveResult = {
			continuityId: "continuity:one-season",
			mediaKind: "tv",
			segments: [firstSegment],
		};

		await provider.fetchWork(oneSegmentResolved);
		await provider.fetchWork(resolved);

		expect(await store.get("tmdb", "tv:999")).toBeDefined();
		expect(fetchFn).toHaveBeenCalledTimes(3);
	});

	const resumedTvResolved: ResolveResult = {
		continuityId: "continuity:resumed-tv",
		mediaKind: "tv",
		segments: [
			{
				instalments: ["tmdb:999#1"],
				kind: "episodic",
				members: { tmdb: SERIES_ID },
			},
			{
				instalments: ["tmdb:999"],
				kind: "atomic",
				members: { tmdb: MOVIE_ID },
			},
			{
				instalments: ["tmdb:999#3"],
				kind: "episodic",
				members: { tmdb: SERIES_ID },
			},
		],
	};

	it("resumes a TV series after an interleaved film at the correct season", async () => {
		const fetchFn = makeFetch();
		const provider = makeProvider(fetchFn);

		const meta = await provider.fetchWork(resumedTvResolved);

		expect(fetchFn.mock.calls.map(([input]) => urlOf(input))).toEqual(
			expect.arrayContaining([
				tvUrl("999"),
				seasonUrl("999", 1),
				movieUrl("999"),
				seasonUrl("999", 2),
			]),
		);
		expect(meta.segments).toHaveLength(3);
		expect(meta.segments[0]?.label).toBe("Season 1");
		expect(meta.segments[1]?.label).toBe("Test Movie");
		expect(meta.segments[2]?.label).toBe("Season 2");
		expect(meta.segments[2]?.year).toBe(2021);
	});

	const tmdbLessResolved: ResolveResult = {
		continuityId: "continuity:tmdb-less",
		mediaKind: "tv",
		segments: [
			{
				instalments: ["tmdb:999#1"],
				kind: "episodic",
				members: { tmdb: SERIES_ID },
			},
			{
				instalments: ["imdb:tt123"],
				kind: "atomic",
				members: {},
			},
			{
				instalments: ["tmdb:999#3"],
				kind: "episodic",
				members: { tmdb: SERIES_ID },
			},
		],
	};

	it("keeps segment index alignment when a segment has no tmdb member", async () => {
		const fetchFn = makeFetch();
		const provider = makeProvider(fetchFn);

		const meta = await provider.fetchWork(tmdbLessResolved);

		expect(meta.segments).toHaveLength(3);
		expect(meta.segments[0]?.label).toBe("Season 1");
		expect(meta.segments[1]).toStrictEqual({
			airedFrom: undefined,
			airedTo: undefined,
			episodes: [],
			label: undefined,
			year: undefined,
		});
		expect(meta.segments[2]?.label).toBe("Season 2");
	});

	it("pads empty segments when a TV series has fewer seasons than the run", async () => {
		const shortSeriesJson = {
			...seriesJson,
			seasons: [
				{ air_date: "2019-12-01", name: "Specials", season_number: 0 },
				{ air_date: "2020-04-01", name: "Season 1", season_number: 1 },
			],
		};
		const shortTvResolved: ResolveResult = {
			continuityId: "continuity:short-tv",
			mediaKind: "tv",
			segments: [
				{
					instalments: ["tmdb:999#1"],
					kind: "episodic",
					members: { tmdb: SERIES_ID },
				},
				{
					instalments: ["tmdb:999#2"],
					kind: "episodic",
					members: { tmdb: SERIES_ID },
				},
				{
					instalments: ["tmdb:200#1"],
					kind: "episodic",
					members: { tmdb: SECOND_SERIES_ID },
				},
			],
		};
		const fetchFn = vi.fn(
			async (input: RequestInfo | URL): Promise<Response> => {
				await Promise.resolve();
				const url = urlOf(input);
				if (url.includes(`/tv/${SERIES_ID}`)) {
					return Response.json(shortSeriesJson);
				}
				return responseFor(urlOf(input));
			},
		);
		const provider = makeProvider(fetchFn);

		const meta = await provider.fetchWork(shortTvResolved);

		expect(meta.segments).toHaveLength(3);
		expect(meta.segments[0]?.label).toBe("Season 1");
		expect(meta.segments[1]).toStrictEqual({
			airedFrom: undefined,
			airedTo: undefined,
			episodes: [],
			label: undefined,
			year: undefined,
		});
		expect(meta.segments[2]?.label).toBe("Season 1");
	});

	it("spans years across a multi-movie atomic run", async () => {
		const fetchFn = makeFetch();
		const store = makeStore();
		const provider = makeProvider(fetchFn, store);

		const meta = await provider.fetchWork(multiMovieResolved);

		expect(fetchFn.mock.calls.map(([input]) => urlOf(input))).toEqual(
			expect.arrayContaining([movieUrl("999"), movieUrl("1000")]),
		);
		expect(meta.span).toBe("2001–2003");
		expect(meta.genres).toStrictEqual([
			"Action",
			"Science Fiction",
			"Adventure",
		]);
		expect(meta.runtimeMinutes).toBe(121);
		expect(meta.productionStatus).toBe("Released");
		expect(meta.segments.map((segment) => segment.label)).toEqual([
			"Test Movie",
			"Test Movie Two",
		]);
		expect(await store.get("tmdb", "movie:999")).toBeDefined();
		expect(await store.get("tmdb", "movie:1000")).toBeDefined();
	});

	it("returns empty metadata when no segment carries a tmdb id", async () => {
		const fetchFn = makeFetch();
		const provider = makeProvider(fetchFn);

		const meta = await provider.fetchWork(noTmdbResolved);

		expect(fetchFn).not.toHaveBeenCalled();
		expect(meta).toMatchObject({
			genres: [],
			productionStatus: undefined,
			runtimeMinutes: undefined,
			segments: [
				{
					airedFrom: undefined,
					airedTo: undefined,
					episodes: [],
					label: undefined,
					year: undefined,
				},
			],
			title: "",
		});
	});

	it("projects a German title and synopsis from stored translations", async () => {
		const meta = await makeProvider(makeFetch()).fetchWork(resolved, {
			locale: "de",
		});
		expect(meta.title).toBe("Testshow");
		expect(meta.synopsis).toBe("Eine Testserie.");
	});

	it("does not recrawl a completed movie the next day", async () => {
		const fetchFn = makeFetch();
		const provider = makeProvider(fetchFn);
		const firstNow = new Date("2026-01-01T00:00:00.000Z");
		await provider.fetchWork(movieResolved, {
			now: firstNow,
			refreshIfDue: true,
		});
		const calls = fetchFn.mock.calls.length;
		await provider.fetchWork(movieResolved, {
			now: new Date("2026-01-02T00:00:00.000Z"),
			refreshIfDue: true,
		});
		expect(fetchFn.mock.calls.length).toBe(calls);
	});

	it("recrawls a continuing series after six hours on the work page", async () => {
		const fetchFn = makeFetch();
		const provider = makeProvider(fetchFn);
		const firstNow = new Date("2026-01-01T00:00:00.000Z");
		await provider.fetchWork(resolved, { now: firstNow, refreshIfDue: true });
		const calls = fetchFn.mock.calls.length;
		await provider.fetchWork(resolved, {
			now: new Date("2026-01-01T06:00:00.000Z"),
			refreshIfDue: true,
		});
		expect(fetchFn.mock.calls.length).toBeGreaterThan(calls);
		const recrawlUrls = fetchFn.mock.calls
			.slice(calls)
			.map(([input]) => urlOf(input));
		expect(recrawlUrls.some((url) => url.includes("append_to_response"))).toBe(
			false,
		);
		expect(recrawlUrls.some((url) => url.includes("/season/"))).toBe(true);
	});
});
