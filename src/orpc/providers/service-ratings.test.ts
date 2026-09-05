import { describe, expect, it, vi } from "vitest";

import type { MemberTitles } from "@/engine";
import type { RateableUnit } from "@/orpc/schema";

import type { MetadataKv } from "./metadata-kv.ts";
import { createRateLimiter } from "./rate-limit.ts";
import { createServiceRatingsProvider } from "./service-ratings.ts";

const members: MemberTitles = {
	anidb: "16947",
	anilist: "140960",
	imdb: "tt10986410",
	mal: "50265",
	tmdb: "120089",
};

const part: RateableUnit = { key: "part:continuity:1:0", kind: "part" };
const movie: RateableUnit = { key: "anidb:film#1", kind: "movie" };

const urlOf = (input: RequestInfo | URL): string => {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
};

const anidbXml = `<?xml version="1.0"?>
<anime id="16947">
	<ratings><permanent count="3183">8.14</permanent></ratings>
</anime>`;

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

const makeFetch = () =>
	vi.fn(
		async (
			input: RequestInfo | URL,
			_init?: RequestInit,
		): Promise<Response> => {
			await Promise.resolve();
			const url = urlOf(input);
			if (url.includes("graphql.anilist.co")) {
				return Response.json({
					data: {
						Media: {
							averageScore: 86,
							meanScore: 85,
							stats: {
								scoreDistribution: [
									{ amount: 100_000, score: 80 },
									{ amount: 114_500, score: 90 },
								],
							},
						},
					},
				});
			}
			if (url.includes("api.jikan.moe")) {
				return Response.json({ data: { score: 8.55, scored_by: 1_182_000 } });
			}
			if (url.includes("api.themoviedb.org")) {
				if (url.includes("/tv/")) {
					return Response.json({ vote_average: 8.4, vote_count: 1287 });
				}
				return Response.json({ vote_average: 7.2, vote_count: 900 });
			}
			if (url.includes("api.anidb.net")) {
				return new Response(anidbXml, { status: 200 });
			}
			if (url.includes("graphql.imdb.com")) {
				return Response.json({
					data: {
						title: {
							metacritic: { metascore: { reviewCount: 42, score: 78 } },
							ratingsSummary: { aggregateRating: 8.3, voteCount: 95_000 },
						},
					},
				});
			}
			return Response.json({ error: "not found" }, { status: 404 });
		},
	);

const makeProvider = (fetchFn: typeof fetch, kv: MetadataKv) =>
	createServiceRatingsProvider({
		anidb: {
			client: "test-client",
			clientVer: "1",
			rateLimiter: createRateLimiter({ intervalMs: 0 }),
		},
		fetchFn,
		resolveKv: () => kv,
		tmdbApiKey: "tmdb-key",
		ttlSeconds: 3600,
	});

describe("service ratings list", () => {
	it("returns a per-service list, each in its native scale, never merged", async () => {
		const fetchFn = makeFetch();
		const { kv } = makeKv();
		const ratings = await makeProvider(fetchFn, kv).ratingsFor(part, members);
		expect(ratings.length).toBeGreaterThan(1);
		expect(new Set(ratings.map((rating) => rating.service)).size).toBe(
			ratings.length,
		);
		for (const rating of ratings) {
			expect(rating.votes).toBeGreaterThan(0);
			expect(rating.score).toBeGreaterThan(0);
			expect(rating.scale).toBeGreaterThan(0);
			expect(rating.score).toBeLessThanOrEqual(rating.scale);
			expect(["user", "critic"]).toContain(rating.kind);
		}
		expect(new Set(ratings.map((rating) => rating.scale))).toEqual(
			new Set([10, 100]),
		);
	});

	it("maps every resolved member id and metacritic onto its own entry", async () => {
		const fetchFn = makeFetch();
		const { kv } = makeKv();
		const ratings = await makeProvider(fetchFn, kv).ratingsFor(part, members);
		expect(new Set(ratings.map((rating) => rating.service))).toEqual(
			new Set(["tmdb", "imdb", "metacritic", "mal", "anilist", "anidb"]),
		);
		expect(ratings.find((rating) => rating.service === "anilist")).toEqual({
			kind: "user",
			scale: 100,
			score: 86,
			service: "anilist",
			votes: 214_500,
		});
		expect(ratings.find((rating) => rating.service === "metacritic")).toEqual({
			kind: "critic",
			scale: 100,
			score: 78,
			service: "metacritic",
			votes: 42,
		});
	});

	it("orders the list deterministically", async () => {
		const fetchFn = makeFetch();
		const { kv } = makeKv();
		const ratings = await makeProvider(fetchFn, kv).ratingsFor(part, members);
		expect(ratings.map((rating) => rating.service)).toEqual([
			"tmdb",
			"imdb",
			"metacritic",
			"mal",
			"anilist",
			"anidb",
		]);
	});

	it("skips services with no member id or no published score", async () => {
		const fetchFn = vi.fn(
			async (input: RequestInfo | URL): Promise<Response> => {
				await Promise.resolve();
				const url = urlOf(input);
				if (url.includes("api.jikan.moe")) {
					return Response.json({ data: {} });
				}
				return Response.json({ error: "not found" }, { status: 404 });
			},
		);
		const { kv } = makeKv();
		expect(
			await makeProvider(fetchFn, kv).ratingsFor(part, {
				mal: "50265",
				tmdb: "120089",
			}),
		).toEqual([]);
	});

	it("serves ratings for films as well as parts", async () => {
		const fetchFn = makeFetch();
		const { kv } = makeKv();
		const ratings = await makeProvider(fetchFn, kv).ratingsFor(movie, {
			tmdb: "603",
		});
		expect(ratings).toEqual([
			{ kind: "user", scale: 10, score: 7.2, service: "tmdb", votes: 900 },
		]);
		const firstCall = fetchFn.mock.calls[0]?.[0];
		expect(firstCall === undefined ? "" : urlOf(firstCall)).toContain(
			"/movie/603",
		);
	});

	it("yields no ratings for episodes or work units", async () => {
		const fetchFn = makeFetch();
		const { kv } = makeKv();
		const provider = makeProvider(fetchFn, kv);
		expect(
			await provider.ratingsFor(
				{ key: "anidb:16947#1", kind: "episode" },
				members,
			),
		).toEqual([]);
		expect(
			await provider.ratingsFor({ key: "continuity:1", kind: "work" }, members),
		).toEqual([]);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it("serves a cache hit with zero upstream subrequests", async () => {
		const fetchFn = makeFetch();
		const { kv, puts } = makeKv();
		const provider = makeProvider(fetchFn, kv);
		const first = await provider.ratingsFor(part, {
			anilist: "140960",
			mal: "50265",
		});
		expect(first).toHaveLength(2);
		expect(fetchFn).toHaveBeenCalledTimes(2);
		expect(puts.every((put) => put.ttl === 3600)).toBe(true);
		fetchFn.mockClear();
		const second = await provider.ratingsFor(part, {
			anilist: "140960",
			mal: "50265",
		});
		expect(second).toEqual(first);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it("keeps other services when one upstream rejects", async () => {
		const fetchFn = vi.fn(
			async (input: RequestInfo | URL): Promise<Response> => {
				await Promise.resolve();
				if (urlOf(input).includes("api.jikan.moe")) {
					throw new Error("mal down");
				}
				return makeFetch()(input);
			},
		);
		const { kv } = makeKv();
		const ratings = await makeProvider(fetchFn, kv).ratingsFor(part, members);
		expect(ratings.map((rating) => rating.service)).toEqual([
			"tmdb",
			"imdb",
			"metacritic",
			"anilist",
			"anidb",
		]);
	});

	it("does not cache a rejected fetch", async () => {
		const fetchFn = vi.fn(
			async (input: RequestInfo | URL): Promise<Response> => {
				await Promise.resolve();
				if (urlOf(input).includes("api.jikan.moe")) {
					return Response.json({ error: "unavailable" }, { status: 503 });
				}
				return Response.json({ error: "not found" }, { status: 404 });
			},
		);
		const { kv, puts } = makeKv();
		const provider = makeProvider(fetchFn, kv);
		expect(await provider.ratingsFor(part, { mal: "50265" })).toEqual([]);
		expect(puts).toEqual([]);
		expect(fetchFn).toHaveBeenCalledTimes(1);
		expect(await provider.ratingsFor(part, { mal: "50265" })).toEqual([]);
		expect(fetchFn).toHaveBeenCalledTimes(2);
	});

	it("caches a successful empty score and skips the next upstream", async () => {
		const fetchFn = vi.fn(async (): Promise<Response> => {
			await Promise.resolve();
			return Response.json({ data: {} });
		});
		const { kv, puts } = makeKv();
		const provider = makeProvider(fetchFn, kv);
		expect(await provider.ratingsFor(part, { mal: "50265" })).toEqual([]);
		expect(puts).toEqual([{ key: "ratings:v1:mal:50265", ttl: 3600 }]);
		fetchFn.mockClear();
		expect(await provider.ratingsFor(part, { mal: "50265" })).toEqual([]);
		expect(fetchFn).not.toHaveBeenCalled();
	});

	it("treats a KV get or put failure as non-fatal", async () => {
		const fetchFn = makeFetch();
		const kv: MetadataKv = {
			get: async () => {
				await Promise.resolve();
				throw new Error("kv get");
			},
			put: async () => {
				await Promise.resolve();
				throw new Error("kv put");
			},
		};
		const ratings = await makeProvider(fetchFn, kv).ratingsFor(part, {
			mal: "50265",
		});
		expect(ratings).toEqual([
			{
				kind: "user",
				scale: 10,
				score: 8.55,
				service: "mal",
				votes: 1_182_000,
			},
		]);
	});

	it("treats malformed cache JSON as a miss", async () => {
		const fetchFn = makeFetch();
		const { kv, store } = makeKv();
		store.set("ratings:v1:mal:50265", "{not-json");
		const ratings = await makeProvider(fetchFn, kv).ratingsFor(part, {
			mal: "50265",
		});
		expect(ratings).toHaveLength(1);
		expect(fetchFn).toHaveBeenCalled();
		expect(store.get("ratings:v1:mal:50265")).not.toBe("{not-json");
	});

	it("separates TMDB cache entries by unit kind", async () => {
		const fetchFn = makeFetch();
		const { kv, puts } = makeKv();
		const provider = makeProvider(fetchFn, kv);
		await provider.ratingsFor(part, { tmdb: "120089" });
		await provider.ratingsFor(movie, { tmdb: "120089" });
		expect(puts.map((put) => put.key)).toEqual([
			"ratings:v1:tmdb:120089:part",
			"ratings:v1:tmdb:120089:movie",
		]);
		const partScores = await provider.ratingsFor(part, { tmdb: "120089" });
		const movieScores = await provider.ratingsFor(movie, { tmdb: "120089" });
		expect(partScores.map((rating) => rating.score)).toEqual([8.4]);
		expect(movieScores.map((rating) => rating.score)).toEqual([7.2]);
	});

	it("passes a timeout abort signal into each upstream fetch", async () => {
		const fetchFn = makeFetch();
		const { kv } = makeKv();
		await makeProvider(fetchFn, kv).ratingsFor(part, { mal: "50265" });
		const init = fetchFn.mock.calls[0]?.[1];
		expect(init?.signal).toBeInstanceOf(AbortSignal);
	});
});
