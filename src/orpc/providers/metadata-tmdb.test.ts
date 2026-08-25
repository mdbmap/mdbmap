import { describe, expect, it, vi } from "vitest";

import type { ResolveResult } from "@/engine";

import { createTmdbProvider } from "./metadata-tmdb.ts";
import type { MetadataKv } from "./metadata-tmdb.ts";

const SERIES_ID = "999";

const resolved: ResolveResult = {
	mediaKind: "tv",
	segments: [
		{ instalments: ["tmdb:999#1", "tmdb:999#2"], members: { tmdb: SERIES_ID } },
		{ instalments: ["tmdb:999#3"], members: { tmdb: SERIES_ID } },
	],
};

const seriesJson = {
	aggregate_credits: {
		cast: [
			{ id: 1, name: "Lead Actor", roles: [{ character: "Hero" }] },
			{ id: 2, name: "Support Actor", roles: [{ character: "Sidekick" }] },
		],
		crew: [
			{ department: "Directing", id: 3, job: "Director", name: "Jane Director" },
			{ department: "Sound", id: 4, job: "Original Music Composer", name: "Sam Score" },
			{ department: "Editing", id: 5, job: "Editor", name: "Ignored Editor" },
		],
	},
	backdrop_path: "/backdrop.jpg",
	created_by: [{ id: 9, name: "Orig Creator" }],
	first_air_date: "2020-04-01",
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

const urlOf = (input: RequestInfo | URL): string => {
	if (typeof input === "string") {
		return input;
	}
	return input instanceof URL ? input.href : input.url;
};

const responseFor = (url: string): Response => {
	if (url.includes("/season/1")) {
		return Response.json(season1Json);
	}
	if (url.includes("/season/2")) {
		return Response.json(season2Json);
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

const makeKv = () => {
	const store = new Map<string, string>();
	const puts: { key: string; ttl: number | undefined }[] = [];
	const kv: MetadataKv = {
		get: async (key) => {
			await Promise.resolve();
			return store.get(key);
		},
		put: async (key, value, options) => {
			await Promise.resolve();
			store.set(key, value);
			puts.push({ key, ttl: options?.expirationTtl });
		},
	};
	return { kv, puts, store };
};

describe("tmdb metadata provider", () => {
	it("normalises a series into WorkMetadata aligned with the engine segments", async () => {
		const fetchFn = makeFetch();
		const { kv } = makeKv();
		const provider = createTmdbProvider({ apiKey: "test-key", fetchFn, resolveKv: () => kv });

		const meta = await provider.fetchWork(resolved);

		expect(meta.title).toBe("Test Show");
		expect(meta.nativeTitle).toBe("テストショー");
		expect(meta.synopsis).toBe("A show used for tests.");
		expect(meta.backdropRef).toBe("tmdb:/backdrop.jpg");
		expect(meta.coverRef).toBe("tmdb:/poster.jpg");
		expect(meta.span).toBe("2020–2021");
		expect(meta.studios).toStrictEqual(["Studio A", "Studio B"]);

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
			{ continuityId: "tmdb:tv:77", coverRef: "tmdb:/similar.jpg", title: "Similar Show" },
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

	it("snapshots core and volatile fields to KV under distinct TTLs", async () => {
		const fetchFn = makeFetch();
		const { kv, puts, store } = makeKv();
		const provider = createTmdbProvider({ apiKey: "test-key", fetchFn, resolveKv: () => kv });

		await provider.fetchWork(resolved);

		const coreKey = `tmdb:v1:core:${SERIES_ID}`;
		const volatileKey = `tmdb:v1:volatile:${SERIES_ID}`;
		expect(store.has(coreKey)).toBe(true);
		expect(store.has(volatileKey)).toBe(true);

		const coreTtl = puts.find((entry) => entry.key === coreKey)?.ttl;
		const volatileTtl = puts.find((entry) => entry.key === volatileKey)?.ttl;
		expect(coreTtl).toBeDefined();
		expect(volatileTtl).toBeDefined();
		expect(coreTtl ?? 0).toBeGreaterThan(volatileTtl ?? 0);
	});

	it("serves a snapshot hit with zero upstream subrequests", async () => {
		const fetchFn = makeFetch();
		const { kv } = makeKv();
		const provider = createTmdbProvider({ apiKey: "test-key", fetchFn, resolveKv: () => kv });

		const first = await provider.fetchWork(resolved);
		const callsAfterMiss = fetchFn.mock.calls.length;
		expect(callsAfterMiss).toBe(3);

		const second = await provider.fetchWork(resolved);
		expect(fetchFn.mock.calls.length).toBe(callsAfterMiss);
		expect(second).toStrictEqual(first);
	});
});
