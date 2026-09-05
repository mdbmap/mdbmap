import { Client, fetchExchange } from "@urql/core";
import { z } from "zod";

import type { RateableUnit, ServiceRating } from "@/orpc/schema";

import { firstChild, parseXml } from "./anidb-xml.ts";
import type { XmlNode } from "./anidb-xml.ts";
import { TitleRatingsQuery } from "./imdb-ratings-query.ts";
import { createRateLimiter } from "./rate-limit.ts";
import type { RateLimiter } from "./rate-limit.ts";

const DEFAULT_IMDB_URL = "https://api.graphql.imdb.com/";
const DEFAULT_ANIDB_URL = "http://api.anidb.net:9001/httpapi";
const DEFAULT_TMDB_URL = "https://api.themoviedb.org/3";
const DEFAULT_ANILIST_URL = "https://graphql.anilist.co";
const DEFAULT_JIKAN_URL = "https://api.jikan.moe/v4";
const ANIDB_FLOOD_INTERVAL_MS = 2000;

type RatedService =
	| "anidb"
	| "anilist"
	| "imdb"
	| "mal"
	| "metacritic"
	| "tmdb";

const scaleFor: Record<RatedService, number> = {
	anidb: 10,
	anilist: 100,
	imdb: 10,
	mal: 10,
	metacritic: 100,
	tmdb: 10,
};

const serviceOrder: readonly RatedService[] = [
	"tmdb",
	"imdb",
	"metacritic",
	"mal",
	"anilist",
	"anidb",
];

const emptyNode: XmlNode = { attrs: {}, children: [], tag: "", text: "" };

const isMissingRating = (response: Response, label: string): boolean => {
	if (response.ok) {
		return false;
	}
	if (response.status === 404) {
		return true;
	}
	throw new Error(`${label}: ${response.status}`);
};

interface AnidbClientConfig {
	baseUrl?: string;
	client: string | undefined;
	clientVer: string | undefined;
	rateLimiter?: RateLimiter;
}

const scoreBucketSchema = z.object({ amount: z.number(), score: z.number() });
const scoreDistributionSchema = z.array(scoreBucketSchema);
const anilistStatsSchema = z.object({
	scoreDistribution: scoreDistributionSchema.optional(),
});
const anilistMediaSchema = z.object({
	averageScore: z.number().nullable().optional(),
	meanScore: z.number().nullable().optional(),
	stats: anilistStatsSchema.nullable().optional(),
});
const anilistResponseSchema = z.object({
	data: z.object({ Media: anilistMediaSchema.nullable().optional() }),
});
const jikanAnimeSchema = z.object({
	data: z.object({
		score: z.number().nullable().optional(),
		scored_by: z.number().nullable().optional(),
	}),
});
const tmdbVotesSchema = z.object({
	vote_average: z.number().optional(),
	vote_count: z.number().optional(),
});

const toRating = (
	service: RatedService,
	kind: ServiceRating["kind"],
	score: number,
	votes: number,
): ServiceRating => ({
	kind,
	scale: scaleFor[service],
	score,
	service,
	votes,
});

const fetchAnilist = async (
	id: string,
	fetchFn: typeof fetch,
	baseUrl = DEFAULT_ANILIST_URL,
): Promise<readonly ServiceRating[]> => {
	const response = await fetchFn(baseUrl, {
		body: JSON.stringify({
			query:
				"query ($id: Int) { Media(id: $id) { averageScore meanScore stats { scoreDistribution { amount score } } } }",
			variables: { id: Number(id) },
		}),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
	if (isMissingRating(response, "anilist")) {
		return [];
	}
	const parsed = anilistResponseSchema.safeParse(await response.json());
	if (!parsed.success) {
		return [];
	}
	const media = parsed.data.data.Media;
	if (media === undefined || media === null) {
		return [];
	}
	const score = media.averageScore ?? media.meanScore;
	if (score === undefined || score === null || score <= 0) {
		return [];
	}
	const votes = (media.stats?.scoreDistribution ?? []).reduce(
		(sum, bucket) => sum + bucket.amount,
		0,
	);
	if (votes <= 0) {
		return [];
	}
	return [toRating("anilist", "user", score, votes)];
};

const fetchMal = async (
	id: string,
	fetchFn: typeof fetch,
	baseUrl = DEFAULT_JIKAN_URL,
): Promise<readonly ServiceRating[]> => {
	const response = await fetchFn(`${baseUrl}/anime/${id}`);
	if (isMissingRating(response, "mal")) {
		return [];
	}
	const parsed = jikanAnimeSchema.safeParse(await response.json());
	if (!parsed.success) {
		return [];
	}
	const { score, scored_by: votes } = parsed.data.data;
	if (
		score === undefined ||
		score === null ||
		score <= 0 ||
		votes === undefined ||
		votes === null ||
		votes <= 0
	) {
		return [];
	}
	return [toRating("mal", "user", score, votes)];
};

const fetchTmdbResource = async (
	kind: "movie" | "tv",
	id: string,
	apiKey: string,
	fetchFn: typeof fetch,
	baseUrl: string,
): Promise<readonly ServiceRating[]> => {
	const response = await fetchFn(
		`${baseUrl}/${kind}/${id}?api_key=${encodeURIComponent(apiKey)}`,
	);
	if (isMissingRating(response, "tmdb")) {
		return [];
	}
	const parsed = tmdbVotesSchema.safeParse(await response.json());
	if (!parsed.success) {
		return [];
	}
	const score = parsed.data.vote_average;
	const votes = parsed.data.vote_count;
	if (score === undefined || score <= 0 || votes === undefined || votes <= 0) {
		return [];
	}
	return [toRating("tmdb", "user", score, votes)];
};

const fetchTmdb = async (
	id: string,
	unit: RateableUnit,
	apiKey: string,
	fetchFn: typeof fetch,
	baseUrl = DEFAULT_TMDB_URL,
): Promise<readonly ServiceRating[]> => {
	if (unit.kind === "movie") {
		return fetchTmdbResource("movie", id, apiKey, fetchFn, baseUrl);
	}
	const asTv = await fetchTmdbResource("tv", id, apiKey, fetchFn, baseUrl);
	if (asTv.length > 0) {
		return asTv;
	}
	return fetchTmdbResource("movie", id, apiKey, fetchFn, baseUrl);
};

const permanentRating = (anime: XmlNode): ServiceRating | undefined => {
	const permanent = firstChild(
		firstChild(anime, "ratings") ?? emptyNode,
		"permanent",
	);
	if (permanent === undefined || permanent.text === "") {
		return undefined;
	}
	const score = Number(permanent.text);
	const countRaw = permanent.attrs["count"];
	const votes = countRaw === undefined ? Number.NaN : Number(countRaw);
	if (
		!Number.isFinite(score) ||
		score <= 0 ||
		!Number.isFinite(votes) ||
		votes <= 0
	) {
		return undefined;
	}
	return toRating("anidb", "user", score, votes);
};

const fetchAnidb = async (
	id: string,
	config: AnidbClientConfig,
	fetchFn: typeof fetch,
): Promise<readonly ServiceRating[]> => {
	const { client, clientVer } = config;
	if (client === undefined || clientVer === undefined) {
		return [];
	}
	const baseUrl = config.baseUrl ?? DEFAULT_ANIDB_URL;
	const rateLimiter =
		config.rateLimiter ??
		createRateLimiter({ intervalMs: ANIDB_FLOOD_INTERVAL_MS });
	const xml = await rateLimiter.run(async () => {
		const query = new URLSearchParams({
			aid: id,
			client,
			clientver: clientVer,
			protover: "1",
			request: "anime",
		});
		const response = await fetchFn(`${baseUrl}?${query.toString()}`);
		if (response.ok) {
			return response.text();
		}
		if (response.status === 404) {
			return;
		}
		throw new Error(`anidb: ${response.status}`);
	});
	if (xml === undefined) {
		return [];
	}
	const root = parseXml(xml);
	const anime = root.tag === "anime" ? root : firstChild(root, "anime");
	if (anime === undefined) {
		return [];
	}
	const rating = permanentRating(anime);
	return rating === undefined ? [] : [rating];
};

const fetchImdbBundle = async (
	id: string,
	fetchFn: typeof fetch,
	imdbUrl = DEFAULT_IMDB_URL,
): Promise<readonly ServiceRating[]> => {
	const client = new Client({
		exchanges: [fetchExchange],
		fetch: fetchFn,
		preferGetMethod: false,
		requestPolicy: "network-only",
		url: imdbUrl,
	});
	const result = await client.query(TitleRatingsQuery, { id }).toPromise();
	if (result.data === undefined) {
		if (result.error !== undefined) {
			throw result.error;
		}
		return [];
	}
	const { title } = result.data;
	if (title === null) {
		return [];
	}
	const ratings: ServiceRating[] = [];
	const summary = title.ratingsSummary;
	if (
		summary !== null &&
		summary.aggregateRating !== null &&
		summary.aggregateRating > 0 &&
		summary.voteCount > 0
	) {
		ratings.push(
			toRating("imdb", "user", summary.aggregateRating, summary.voteCount),
		);
	}
	const metascore = title.metacritic?.metascore;
	if (
		metascore !== undefined &&
		metascore !== null &&
		metascore.score > 0 &&
		metascore.reviewCount > 0
	) {
		ratings.push(
			toRating("metacritic", "critic", metascore.score, metascore.reviewCount),
		);
	}
	return ratings;
};

export {
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
};
export type { AnidbClientConfig, RatedService };
