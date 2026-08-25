import { z } from "zod";

import type { ResolveResult } from "@/engine";
import type { Credit, Similar } from "@/orpc/schema";

import type {
	EpisodeMetadata,
	MetadataProvider,
	SegmentMetadata,
	WorkMetadata,
} from "./types.ts";

// Real TMDB provider (#5). Given the engine's resolved members it fetches a TMDB
// series and its seasons, normalises them into WorkMetadata (segments aligned
// index-for-index with the engine's segments), and snapshots the result to KV
// split by volatility. A snapshot hit performs zero upstream subrequests.

const SNAPSHOT_VERSION = 1;
const DEFAULT_BASE_URL = "https://api.themoviedb.org/3";
// Slow fields (title, cast, studios) live a week; volatile ones (airing
// episodes, dates) a few hours.
const DEFAULT_CORE_TTL_SECONDS = 604_800;
const DEFAULT_VOLATILE_TTL_SECONDS = 21_600;
const MAX_CAST = 30;
const MAX_SIMILAR = 12;
const YEAR_LENGTH = 4;

// TMDB crew job -> the role label we display. Everything else is dropped.
const STAFF_JOBS = new Map<string, string>([
	["Director", "Director"],
	["Series Composition", "Series Composition"],
	["Character Designer", "Character Design"],
	["Original Music Composer", "Music"],
	["Music", "Music"],
]);

interface MetadataKv {
	get: (key: string) => Promise<string | undefined>;
	put: (
		key: string,
		value: string,
		options?: { expirationTtl: number },
	) => Promise<void>;
}

interface TmdbProviderDeps {
	apiKey: string | undefined;
	resolveKv: () => MetadataKv | Promise<MetadataKv>;
	baseUrl?: string;
	coreTtlSeconds?: number;
	fetchFn?: typeof fetch;
	version?: number;
	volatileTtlSeconds?: number;
}

const creditSchema = z.object({
	name: z.string(),
	ref: z.string().optional(),
	role: z.string(),
});

const similarSchema = z.object({
	continuityId: z.string(),
	coverRef: z.string().optional(),
	title: z.string(),
});

const episodeSchema = z.object({
	airDate: z.string().optional(),
	number: z.number(),
	title: z.string(),
});

const coreSegmentSchema = z.object({
	label: z.string(),
	year: z.number().optional(),
});

const volatileSegmentSchema = z.object({
	airedFrom: z.string().optional(),
	airedTo: z.string().optional(),
	episodes: z.array(episodeSchema),
});

const coreSnapshotSchema = z.object({
	backdropRef: z.string().optional(),
	cast: z.array(creditSchema),
	coverRef: z.string().optional(),
	ifYouLiked: z.array(similarSchema),
	nativeTitle: z.string().optional(),
	segments: z.array(coreSegmentSchema),
	staff: z.array(creditSchema),
	studios: z.array(z.string()),
	synopsis: z.string(),
	title: z.string(),
	version: z.number(),
});

const volatileSnapshotSchema = z.object({
	segments: z.array(volatileSegmentSchema),
	span: z.string(),
	version: z.number(),
});

type CoreSnapshot = z.infer<typeof coreSnapshotSchema>;
type VolatileSnapshot = z.infer<typeof volatileSnapshotSchema>;

const tmdbRoleSchema = z.object({ character: z.string().optional() });
const tmdbCastSchema = z.object({
	id: z.number(),
	name: z.string(),
	roles: z.array(tmdbRoleSchema).optional(),
});
const tmdbCrewSchema = z.object({
	id: z.number(),
	job: z.string().optional(),
	name: z.string(),
});
const tmdbCreditsSchema = z.object({
	cast: z.array(tmdbCastSchema).optional(),
	crew: z.array(tmdbCrewSchema).optional(),
});
const tmdbCreatorSchema = z.object({ id: z.number(), name: z.string() });
const tmdbCompanySchema = z.object({ name: z.string() });
const tmdbRecommendationSchema = z.object({
	id: z.number(),
	name: z.string().optional(),
	poster_path: z.string().optional(),
});
const tmdbRecommendationsSchema = z.object({
	results: z.array(tmdbRecommendationSchema).optional(),
});
const tmdbSeasonSummarySchema = z.object({
	air_date: z.string().optional(),
	name: z.string().optional(),
	season_number: z.number(),
});
const tmdbSeriesSchema = z.object({
	aggregate_credits: tmdbCreditsSchema.optional(),
	backdrop_path: z.string().optional(),
	created_by: z.array(tmdbCreatorSchema).optional(),
	first_air_date: z.string().optional(),
	last_air_date: z.string().optional(),
	name: z.string().optional(),
	original_name: z.string().optional(),
	overview: z.string().optional(),
	poster_path: z.string().optional(),
	production_companies: z.array(tmdbCompanySchema).optional(),
	recommendations: tmdbRecommendationsSchema.optional(),
	seasons: z.array(tmdbSeasonSummarySchema).optional(),
});

const tmdbEpisodeSchema = z.object({
	air_date: z.string().optional(),
	episode_number: z.number(),
	name: z.string().optional(),
});
const tmdbSeasonSchema = z.object({
	air_date: z.string().optional(),
	episodes: z.array(tmdbEpisodeSchema).optional(),
});

type TmdbSeries = z.infer<typeof tmdbSeriesSchema>;
type TmdbSeason = z.infer<typeof tmdbSeasonSchema>;

const imageRef = (path: string | undefined): string | undefined =>
	path === undefined || path === "" ? undefined : `tmdb:${path}`;

const yearOf = (date: string | undefined): number | undefined => {
	if (date === undefined) {
		return undefined;
	}
	const head = date.slice(0, YEAR_LENGTH);
	if (head.length < YEAR_LENGTH) {
		return undefined;
	}
	const year = Number(head);
	return Number.isNaN(year) ? undefined : year;
};

const seriesIdOf = (resolved: ResolveResult): string | undefined => {
	for (const segment of resolved.segments) {
		if (segment.members.tmdb !== undefined) {
			return segment.members.tmdb;
		}
	}
	return undefined;
};

const keyFor = (kind: "core" | "volatile", version: number, seriesId: string) =>
	`tmdb:v${version}:${kind}:${seriesId}`;

const normaliseCast = (series: TmdbSeries): Credit[] =>
	(series.aggregate_credits?.cast ?? []).slice(0, MAX_CAST).map((member) => ({
		name: member.name,
		ref: `tmdb:person:${member.id}`,
		role: member.roles?.[0]?.character ?? "",
	}));

const normaliseStaff = (series: TmdbSeries): Credit[] => {
	const staff: Credit[] = [];
	const seen = new Set<string>();
	const add = (name: string, ref: string, role: string) => {
		const dedupeKey = `${role}:${name}`;
		if (seen.has(dedupeKey)) {
			return;
		}
		seen.add(dedupeKey);
		staff.push({ name, ref, role });
	};
	for (const creator of series.created_by ?? []) {
		add(creator.name, `tmdb:person:${creator.id}`, "Original Creator");
	}
	for (const member of series.aggregate_credits?.crew ?? []) {
		const role = member.job === undefined ? undefined : STAFF_JOBS.get(member.job);
		if (role !== undefined) {
			add(member.name, `tmdb:person:${member.id}`, role);
		}
	}
	return staff;
};

const normaliseSimilar = (series: TmdbSeries): Similar[] =>
	(series.recommendations?.results ?? []).slice(0, MAX_SIMILAR).map((rec) => ({
		continuityId: `tmdb:tv:${rec.id}`,
		coverRef: imageRef(rec.poster_path),
		title: rec.name ?? "",
	}));

const spanOf = (series: TmdbSeries): string => {
	const from = yearOf(series.first_air_date);
	const to = yearOf(series.last_air_date);
	if (from === undefined) {
		return "";
	}
	if (to === undefined || to === from) {
		return `${from}`;
	}
	return `${from}–${to}`;
};

interface SeasonSummary {
	label: string;
	year: number | undefined;
}

interface Snapshots {
	core: CoreSnapshot;
	volatile: VolatileSnapshot;
}

const volatileSegmentOf = (season: TmdbSeason) => {
	const episodes: EpisodeMetadata[] = (season.episodes ?? []).map((episode) => ({
		airDate: episode.air_date,
		number: episode.episode_number,
		title: episode.name ?? `Episode ${episode.episode_number}`,
	}));
	return {
		airedFrom: season.air_date ?? episodes[0]?.airDate,
		airedTo: episodes.at(-1)?.airDate,
		episodes,
	};
};

const buildSnapshots = (
	version: number,
	series: TmdbSeries,
	seasons: readonly TmdbSeason[],
	summaries: readonly SeasonSummary[],
): Snapshots => {
	const title = series.name ?? "";
	const nativeTitle =
		series.original_name !== undefined && series.original_name !== title
			? series.original_name
			: undefined;

	const core = coreSnapshotSchema.parse({
		backdropRef: imageRef(series.backdrop_path),
		cast: normaliseCast(series),
		coverRef: imageRef(series.poster_path),
		ifYouLiked: normaliseSimilar(series),
		nativeTitle,
		segments: summaries.map((summary) => ({ label: summary.label, year: summary.year })),
		staff: normaliseStaff(series),
		studios: (series.production_companies ?? []).map((company) => company.name),
		synopsis: series.overview ?? "",
		title,
		version,
	});

	const volatile = volatileSnapshotSchema.parse({
		segments: seasons.map((season) => volatileSegmentOf(season)),
		span: spanOf(series),
		version,
	});

	return { core, volatile };
};

const toCredit = (credit: CoreSnapshot["cast"][number]): Credit => ({
	name: credit.name,
	ref: credit.ref,
	role: credit.role,
});

const toEpisode = (
	episode: VolatileSnapshot["segments"][number]["episodes"][number],
): EpisodeMetadata => ({
	airDate: episode.airDate,
	number: episode.number,
	title: episode.title,
});

const assemble = (core: CoreSnapshot, volatile: VolatileSnapshot): WorkMetadata => {
	const segments: SegmentMetadata[] = core.segments.map((coreSegment, index) => {
		const volatileSegment = volatile.segments[index];
		return {
			airedFrom: volatileSegment?.airedFrom,
			airedTo: volatileSegment?.airedTo,
			episodes: (volatileSegment?.episodes ?? []).map((episode) => toEpisode(episode)),
			label: coreSegment.label,
			year: coreSegment.year,
		};
	});
	return {
		backdropRef: core.backdropRef,
		cast: core.cast.map((credit) => toCredit(credit)),
		coverRef: core.coverRef,
		ifYouLiked: core.ifYouLiked.map((similar) => ({
			continuityId: similar.continuityId,
			coverRef: similar.coverRef,
			title: similar.title,
		})),
		nativeTitle: core.nativeTitle,
		segments,
		span: volatile.span,
		staff: core.staff.map((credit) => toCredit(credit)),
		studios: [...core.studios],
		synopsis: core.synopsis,
		title: core.title,
	};
};

const readSnapshot = async <Schema extends z.ZodType<{ version: number }>>(
	kv: MetadataKv,
	key: string,
	schema: Schema,
	version: number,
): Promise<z.infer<Schema> | undefined> => {
	const text = await kv.get(key);
	if (text === undefined) {
		return undefined;
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return undefined;
	}
	const result = schema.safeParse(raw);
	if (!result.success || result.data.version !== version) {
		return undefined;
	}
	return result.data;
};

interface HttpContext {
	apiKey: string | undefined;
	baseUrl: string;
	fetchFn: typeof fetch;
}

const getJson = async <Schema extends z.ZodType>(
	http: HttpContext,
	path: string,
	schema: Schema,
): Promise<z.infer<Schema>> => {
	if (http.apiKey === undefined) {
		throw new Error("tmdb: TMDB_API_KEY is not configured");
	}
	const separator = path.includes("?") ? "&" : "?";
	const response = await http.fetchFn(
		`${http.baseUrl}${path}${separator}api_key=${http.apiKey}`,
	);
	if (!response.ok) {
		throw new Error(`tmdb: ${response.status} for ${path}`);
	}
	const json: unknown = await response.json();
	return schema.parse(json);
};

const fetchFromTmdb = async (
	http: HttpContext,
	version: number,
	seriesId: string,
	segmentCount: number,
): Promise<Snapshots> => {
	const series = await getJson(
		http,
		`/tv/${seriesId}?append_to_response=aggregate_credits,recommendations`,
		tmdbSeriesSchema,
	);
	const regularSeasons = (series.seasons ?? [])
		.filter((season) => season.season_number >= 1)
		.toSorted((left, right) => left.season_number - right.season_number)
		.slice(0, segmentCount);

	const seasons = await Promise.all(
		regularSeasons.map(async (season) => {
			const detail = await getJson(
				http,
				`/tv/${seriesId}/season/${season.season_number}`,
				tmdbSeasonSchema,
			);
			return detail;
		}),
	);
	const summaries: SeasonSummary[] = regularSeasons.map((season, index) => ({
		label: season.name ?? `Season ${index + 1}`,
		year: yearOf(season.air_date ?? seasons[index]?.air_date),
	}));

	return buildSnapshots(version, series, seasons, summaries);
};

const createTmdbProvider = (deps: TmdbProviderDeps): MetadataProvider => {
	const {
		apiKey,
		resolveKv,
		baseUrl = DEFAULT_BASE_URL,
		coreTtlSeconds = DEFAULT_CORE_TTL_SECONDS,
		fetchFn = fetch,
		version = SNAPSHOT_VERSION,
		volatileTtlSeconds = DEFAULT_VOLATILE_TTL_SECONDS,
	} = deps;
	const http: HttpContext = { apiKey, baseUrl, fetchFn };

	const fetchWork = async (resolved: ResolveResult): Promise<WorkMetadata> => {
		const seriesId = seriesIdOf(resolved);
		if (seriesId === undefined) {
			throw new Error("tmdb: resolved members carry no tmdb series id");
		}
		const kv = await resolveKv();
		const coreKey = keyFor("core", version, seriesId);
		const volatileKey = keyFor("volatile", version, seriesId);

		const core = await readSnapshot(kv, coreKey, coreSnapshotSchema, version);
		const volatile = await readSnapshot(kv, volatileKey, volatileSnapshotSchema, version);
		if (core !== undefined && volatile !== undefined) {
			return assemble(core, volatile);
		}

		const fetched = await fetchFromTmdb(http, version, seriesId, resolved.segments.length);
		await kv.put(coreKey, JSON.stringify(fetched.core), { expirationTtl: coreTtlSeconds });
		await kv.put(volatileKey, JSON.stringify(fetched.volatile), {
			expirationTtl: volatileTtlSeconds,
		});
		return assemble(fetched.core, fetched.volatile);
	};

	return { fetchWork };
};

export { createTmdbProvider };
export type { MetadataKv, TmdbProviderDeps };
