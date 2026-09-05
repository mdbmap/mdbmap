import { z } from "zod";

import type { MemberTitles } from "@/engine";
import { env } from "@/env";
import type { RateableUnit, ServiceRating } from "@/orpc/schema";

import type { MetadataKv } from "./metadata-kv.ts";
import { createRateLimiter } from "./rate-limit.ts";
import {
	DEFAULT_ANILIST_URL,
	DEFAULT_IMDB_URL,
	DEFAULT_JIKAN_URL,
	DEFAULT_TMDB_URL,
	fetchAnidb,
	fetchAnilist,
	fetchImdbBundle,
	fetchMal,
	fetchTmdb,
	serviceOrder,
} from "./service-ratings-fetch.ts";
import type {
	AnidbClientConfig,
	RatedService,
} from "./service-ratings-fetch.ts";
import type { ServiceRatingsProvider } from "./types.ts";

const SNAPSHOT_VERSION = 1;
const DEFAULT_TTL_SECONDS = 21_600;

interface ServiceRatingsDeps {
	anidb: AnidbClientConfig;
	anilistUrl?: string;
	fetchFn?: typeof fetch;
	imdbUrl?: string;
	jikanUrl?: string;
	resolveKv: () => MetadataKv | Promise<MetadataKv>;
	tmdbApiKey: string | undefined;
	tmdbBaseUrl?: string;
	ttlSeconds?: number;
	version?: number;
}

const ratingBodySchema = z.object({
	kind: z.enum(["critic", "user"]),
	scale: z.number(),
	score: z.number(),
	service: z.string(),
	votes: z.number(),
});

const snapshotSchema = z.object({
	ratings: z.array(ratingBodySchema),
	version: z.number(),
});

type Snapshot = z.infer<typeof snapshotSchema>;

const keyFor = (version: number, cacheKey: string) =>
	`ratings:v${version}:${cacheKey}`;

const isRatedService = (service: string): service is RatedService =>
	serviceOrder.some((candidate) => candidate === service);

const readSnapshot = async (
	kv: MetadataKv,
	key: string,
	version: number,
): Promise<Snapshot | undefined> => {
	let raw: string | undefined;
	try {
		raw = await kv.get(key);
	} catch {
		return undefined;
	}
	if (raw === undefined) {
		return undefined;
	}
	let decoded: unknown;
	try {
		decoded = JSON.parse(raw);
	} catch {
		return undefined;
	}
	const parsed = snapshotSchema.safeParse(decoded);
	if (!parsed.success || parsed.data.version !== version) {
		return undefined;
	}
	return parsed.data;
};

const writeSnapshot = async (
	kv: MetadataKv,
	key: string,
	snapshot: Snapshot,
	ttlSeconds: number,
): Promise<void> => {
	try {
		await kv.put(key, JSON.stringify(snapshot), { expirationTtl: ttlSeconds });
	} catch {
		// Cache writes are best-effort; live ratings still return.
	}
};

const cacheKeyFor = (
	service: "anidb" | "anilist" | "imdb" | "mal" | "tmdb",
	id: string,
) => `${service}:${id}`;

const FETCH_TIMEOUT_MS = 8000;

const mergeAbortSignals = (
	timeout: AbortSignal,
	caller: AbortSignal | undefined,
): AbortSignal => {
	if (caller === undefined) {
		return timeout;
	}
	return AbortSignal.any([caller, timeout]) ?? timeout;
};

const fetchWithTimeout =
	(fetchFn: typeof fetch, ms: number): typeof fetch =>
	async (input, init) =>
		fetchFn(input, {
			...init,
			signal: mergeAbortSignals(
				AbortSignal.timeout(ms),
				init?.signal ?? undefined,
			),
		});

const loadCachedOrFetch = async (
	kv: MetadataKv,
	version: number,
	ttlSeconds: number,
	cacheKey: string,
	fetchLive: () => Promise<readonly ServiceRating[]>,
): Promise<readonly ServiceRating[]> => {
	const key = keyFor(version, cacheKey);
	const cached = await readSnapshot(kv, key, version);
	if (cached !== undefined) {
		return cached.ratings;
	}
	let ratings: readonly ServiceRating[];
	try {
		ratings = await fetchLive();
	} catch {
		return [];
	}
	await writeSnapshot(kv, key, { ratings: [...ratings], version }, ttlSeconds);
	return ratings;
};

const absorb = (
	byService: Map<RatedService, ServiceRating>,
	ratings: readonly ServiceRating[],
): void => {
	for (const rating of ratings) {
		if (isRatedService(rating.service)) {
			byService.set(rating.service, rating);
		}
	}
};

interface FetchPlan {
	anidb: AnidbClientConfig;
	anilistUrl: string;
	fetchFn: typeof fetch;
	imdbUrl: string;
	jikanUrl: string;
	kv: MetadataKv;
	tmdbApiKey: string | undefined;
	tmdbBaseUrl: string;
	ttlSeconds: number;
	version: number;
}

const enqueue = (
	tasks: Promise<void>[],
	plan: FetchPlan,
	byService: Map<RatedService, ServiceRating>,
	cacheKey: string,
	fetchLive: () => Promise<readonly ServiceRating[]>,
): void => {
	tasks.push(
		(async () => {
			absorb(
				byService,
				await loadCachedOrFetch(
					plan.kv,
					plan.version,
					plan.ttlSeconds,
					cacheKey,
					fetchLive,
				),
			);
		})(),
	);
};

const enqueueMemberFetches = (
	plan: FetchPlan,
	unit: RateableUnit,
	members: MemberTitles,
	byService: Map<RatedService, ServiceRating>,
): Promise<void>[] => {
	const tasks: Promise<void>[] = [];
	const fetchFn = fetchWithTimeout(plan.fetchFn, FETCH_TIMEOUT_MS);
	if (members.tmdb !== undefined && plan.tmdbApiKey !== undefined) {
		const id = members.tmdb;
		const apiKey = plan.tmdbApiKey;
		enqueue(
			tasks,
			plan,
			byService,
			`${cacheKeyFor("tmdb", id)}:${unit.kind}`,
			async () => fetchTmdb(id, unit, apiKey, fetchFn, plan.tmdbBaseUrl),
		);
	}
	if (members.imdb !== undefined) {
		const id = members.imdb;
		enqueue(tasks, plan, byService, cacheKeyFor("imdb", id), async () =>
			fetchImdbBundle(id, fetchFn, plan.imdbUrl),
		);
	}
	if (members.mal !== undefined) {
		const id = members.mal;
		enqueue(tasks, plan, byService, cacheKeyFor("mal", id), async () =>
			fetchMal(id, fetchFn, plan.jikanUrl),
		);
	}
	if (members.anilist !== undefined) {
		const id = members.anilist;
		enqueue(tasks, plan, byService, cacheKeyFor("anilist", id), async () =>
			fetchAnilist(id, fetchFn, plan.anilistUrl),
		);
	}
	if (
		members.anidb !== undefined &&
		plan.anidb.client !== undefined &&
		plan.anidb.clientVer !== undefined
	) {
		const id = members.anidb;
		enqueue(tasks, plan, byService, cacheKeyFor("anidb", id), async () =>
			fetchAnidb(id, plan.anidb, fetchFn),
		);
	}
	return tasks;
};

const orderRatings = (
	byService: Map<RatedService, ServiceRating>,
): ServiceRating[] => {
	const ordered: ServiceRating[] = [];
	for (const service of serviceOrder) {
		const rating = byService.get(service);
		if (rating !== undefined) {
			ordered.push(rating);
		}
	}
	return ordered;
};

const withAnidbLimiter = (anidb: AnidbClientConfig): AnidbClientConfig => ({
	...anidb,
	rateLimiter: anidb.rateLimiter ?? createRateLimiter({ intervalMs: 2000 }),
});

const createServiceRatingsProvider = (
	deps: ServiceRatingsDeps,
): ServiceRatingsProvider => {
	const {
		anidb,
		anilistUrl = DEFAULT_ANILIST_URL,
		fetchFn = fetch,
		imdbUrl = DEFAULT_IMDB_URL,
		jikanUrl = DEFAULT_JIKAN_URL,
		resolveKv,
		tmdbApiKey,
		tmdbBaseUrl = DEFAULT_TMDB_URL,
		ttlSeconds = DEFAULT_TTL_SECONDS,
		version = SNAPSHOT_VERSION,
	} = deps;
	const gatedAnidb = withAnidbLimiter(anidb);

	const ratingsFor: ServiceRatingsProvider["ratingsFor"] = async (
		unit,
		members,
	) => {
		if (unit.kind !== "part" && unit.kind !== "movie") {
			return [];
		}
		const kv = await resolveKv();
		const byService = new Map<RatedService, ServiceRating>();
		await Promise.all(
			enqueueMemberFetches(
				{
					anidb: gatedAnidb,
					anilistUrl,
					fetchFn,
					imdbUrl,
					jikanUrl,
					kv,
					tmdbApiKey,
					tmdbBaseUrl,
					ttlSeconds,
					version,
				},
				unit,
				members,
				byService,
			),
		);
		return orderRatings(byService);
	};

	return { ratingsFor };
};

const resolveMetadataKv = async (): Promise<MetadataKv> => {
	const { env: workerEnv } = await import("cloudflare:workers");
	const namespace = workerEnv.METADATA_KV;
	return {
		get: async (key) => (await namespace.get(key)) ?? undefined,
		put: async (key, value, options) => {
			await namespace.put(key, value, options);
		},
	};
};

const serviceRatingsProvider = createServiceRatingsProvider({
	anidb: {
		client: env.ANIDB_CLIENT,
		clientVer: env.ANIDB_CLIENT_VER,
	},
	resolveKv: resolveMetadataKv,
	tmdbApiKey: env.TMDB_API_KEY,
});

export { createServiceRatingsProvider, serviceRatingsProvider };
export { serviceOrder } from "./service-ratings-fetch.ts";
export type { ServiceRatingsDeps };
