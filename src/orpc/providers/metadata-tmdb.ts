import type { z } from "zod";

import type { ResolveResult } from "@/engine";

import { assemble } from "./metadata-document.ts";
import type { Snapshots } from "./metadata-document.ts";
import type {
	MetadataFetchOptions,
	SnapshotNeed,
} from "./metadata-freshness.ts";
import {
	lastUpdatedIso,
	resolveCatalogueDocument,
	settleDocuments,
} from "./metadata-load.ts";
import type { LoadedDocument } from "./metadata-load.ts";
import type { MetadataStore } from "./metadata-store.ts";
import {
	MOVIE_APPEND,
	TV_APPEND,
	buildMovieSnapshots,
	buildSnapshots,
	regularSeasonsOf,
	tmdbMovieSchema,
	tmdbSeasonSchema,
	tmdbSeriesSchema,
	yearOf,
} from "./metadata-tmdb-parse.ts";
import type { TmdbSeason, TmdbSeries } from "./metadata-tmdb-parse.ts";
import type {
	MetadataProvider,
	SegmentMetadata,
	WorkMetadata,
} from "./types.ts";

const SNAPSHOT_VERSION = 3;
const DEFAULT_BASE_URL = "https://api.themoviedb.org/3";
const DEFAULT_LOCALE = "en";

interface TmdbProviderDeps {
	apiKey: string | undefined;
	resolveStore: () => MetadataStore | Promise<MetadataStore>;
	baseUrl?: string;
	fetchFn?: typeof fetch;
	version?: number;
}

type TmdbResource = { kind: "movie"; id: number } | { kind: "tv"; id: number };

const resourceId = (value: string): number | undefined => {
	const id = Number(value);
	return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

interface ResourceRun {
	kind: TmdbResource["kind"];
	resources: readonly TmdbResource[];
	seasonOffset: number | undefined;
}

const entryKeyOf = (resource: TmdbResource): string =>
	`${resource.kind}:${resource.id}`;

const runsOf = (resolved: ResolveResult): ResourceRun[] => {
	const runs: ResourceRun[] = [];
	let current: TmdbResource[] = [];
	let currentSeasonOffset: number | undefined;
	const tvSeasonCounts = new Map<number, number>();

	const flush = () => {
		if (current.length === 0) {
			return;
		}
		const [head] = current;
		if (head === undefined) {
			return;
		}
		runs.push({
			kind: head.kind,
			resources: current,
			seasonOffset: currentSeasonOffset,
		});
		current = [];
		currentSeasonOffset = undefined;
	};

	for (const segment of resolved.segments) {
		const value = segment.members.tmdb;
		if (value === undefined) {
			flush();
			continue;
		}
		const id = resourceId(value);
		if (id === undefined) {
			throw new Error(`tmdb: resolved member has invalid tmdb id ${value}`);
		}
		const kind = segment.kind === "atomic" ? "movie" : "tv";
		const [head] = current;
		const continuesRun =
			head !== undefined &&
			head.kind === kind &&
			(kind === "movie" || head.id === id);
		if (!continuesRun) {
			flush();
			if (kind === "tv") {
				currentSeasonOffset = tvSeasonCounts.get(id) ?? 0;
			}
		}
		current.push({ id, kind });
		if (kind === "tv") {
			tvSeasonCounts.set(id, (tvSeasonCounts.get(id) ?? 0) + 1);
		}
	}
	flush();
	return runs;
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

const seasonSummaries = (
	series: TmdbSeries,
	seasons: readonly TmdbSeason[],
): { label: string; year: number | undefined }[] =>
	regularSeasonsOf(series).map((season, index) => ({
		label: season.name ?? `Season ${season.season_number}`,
		year: yearOf(season.air_date ?? seasons[index]?.air_date),
	}));

const fetchSeriesDetails = async (
	http: HttpContext,
	seriesId: string,
	withCoreAppend: boolean,
) =>
	getJson(
		http,
		withCoreAppend
			? `/tv/${seriesId}?append_to_response=${TV_APPEND}`
			: `/tv/${seriesId}`,
		tmdbSeriesSchema,
	);

const fetchSeason = async (
	http: HttpContext,
	seriesId: string,
	seasonNumber: number,
) => getJson(http, `/tv/${seriesId}/season/${seasonNumber}`, tmdbSeasonSchema);

const fetchSeriesSnapshots = async (
	http: HttpContext,
	version: number,
	seriesId: string,
	need: SnapshotNeed,
	previous: Snapshots | undefined,
): Promise<Snapshots> => {
	const fetchCore = need.fetchCore || previous === undefined;
	const fetchVolatile = need.fetchVolatile || previous === undefined;
	const series = await fetchSeriesDetails(http, seriesId, fetchCore);
	if (fetchCore && fetchVolatile) {
		const regularSeasons = regularSeasonsOf(series);
		const seasons = await Promise.all(
			regularSeasons.map(async (season) =>
				fetchSeason(http, seriesId, season.season_number),
			),
		);
		return buildSnapshots(
			version,
			series,
			seasons,
			seasonSummaries(series, seasons),
		);
	}
	if (fetchCore && previous !== undefined) {
		const { core } = buildSnapshots(
			version,
			series,
			[],
			seasonSummaries(series, []),
		);
		return { core, volatile: previous.volatile };
	}
	const regularSeasons = regularSeasonsOf(series);
	const seasons = await Promise.all(
		regularSeasons.map(async (season) =>
			fetchSeason(http, seriesId, season.season_number),
		),
	);
	const { volatile } = buildSnapshots(
		version,
		series,
		seasons,
		seasonSummaries(series, seasons),
	);
	if (previous === undefined) {
		throw new Error("tmdb: volatile refresh is missing a stored core snapshot");
	}
	return { core: previous.core, volatile };
};

const fetchMovieSnapshots = async (
	http: HttpContext,
	version: number,
	resource: TmdbResource,
): Promise<Snapshots> => {
	const movie = await getJson(
		http,
		`/movie/${resource.id}?append_to_response=${MOVIE_APPEND}`,
		tmdbMovieSchema,
	);
	return buildMovieSnapshots(version, movie);
};

const uniqueResources = (runs: readonly ResourceRun[]): TmdbResource[] => {
	const seen = new Set<string>();
	const resources: TmdbResource[] = [];
	for (const run of runs) {
		if (run.kind === "tv") {
			const [head] = run.resources;
			if (head === undefined) {
				continue;
			}
			const key = entryKeyOf(head);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			resources.push(head);
			continue;
		}
		for (const resource of run.resources) {
			const key = entryKeyOf(resource);
			if (seen.has(key)) {
				continue;
			}
			seen.add(key);
			resources.push(resource);
		}
	}
	return resources;
};

const emptySegment = (): SegmentMetadata => ({
	airedFrom: undefined,
	airedTo: undefined,
	episodes: [],
	label: undefined,
	year: undefined,
});

const emptyMetadata = (segmentCount: number): WorkMetadata => ({
	backdropRef: undefined,
	cast: [],
	coverRef: undefined,
	genres: [],
	ifYouLiked: [],
	nativeTitle: undefined,
	productionStatus: undefined,
	runtimeMinutes: undefined,
	segments: Array.from({ length: segmentCount }, () => emptySegment()),
	span: "",
	staff: [],
	studios: [],
	synopsis: "",
	title: "",
});

const tvSlice = (
	document: LoadedDocument,
	offset: number,
	count: number,
	locale: string,
): SegmentMetadata[] => {
	const assembled = assemble(
		document.snapshots.core,
		document.snapshots.volatile,
		locale,
	);
	return assembled.segments.slice(offset, offset + count);
};

const movieSegment = (
	document: LoadedDocument,
	locale: string,
): SegmentMetadata => {
	const [segment] = assemble(
		document.snapshots.core,
		document.snapshots.volatile,
		locale,
	).segments;
	return segment ?? emptySegment();
};

const uniqueGenres = (documents: readonly LoadedDocument[]): string[] => {
	const seen = new Set<string>();
	const genres: string[] = [];
	for (const document of documents) {
		for (const genre of document.snapshots.core.genres) {
			if (seen.has(genre)) {
				continue;
			}
			seen.add(genre);
			genres.push(genre);
		}
	}
	return genres;
};

const yearSpanFromSegments = (segments: readonly SegmentMetadata[]): string => {
	const years = segments
		.map((segment) => segment.year)
		.filter((year): year is number => year !== undefined);
	if (years.length === 0) {
		return "";
	}
	const from = Math.min(...years);
	const to = Math.max(...years);
	return from === to ? `${from}` : `${from}–${to}`;
};

const createTmdbProvider = (deps: TmdbProviderDeps): MetadataProvider => {
	const {
		apiKey,
		resolveStore,
		baseUrl = DEFAULT_BASE_URL,
		fetchFn = fetch,
		version = SNAPSHOT_VERSION,
	} = deps;
	const http: HttpContext = { apiKey, baseUrl, fetchFn };

	const fetchWork = async (
		resolved: ResolveResult,
		options: MetadataFetchOptions = {},
	): Promise<WorkMetadata> => {
		const locale = options.locale ?? DEFAULT_LOCALE;
		const now = options.now ?? new Date();
		const runs = runsOf(resolved);
		if (runs.length === 0) {
			return emptyMetadata(resolved.segments.length);
		}
		const store = await resolveStore();
		const resources = uniqueResources(runs);
		const documents = await settleDocuments(
			resources.map((resource) => ({
				key: entryKeyOf(resource),
				load: async () =>
					resolveCatalogueDocument({
						entryKey: entryKeyOf(resource),
						fetchSnapshots: async (need, previous) =>
							resource.kind === "movie"
								? fetchMovieSnapshots(http, version, resource)
								: fetchSeriesSnapshots(
										http,
										version,
										String(resource.id),
										need,
										previous,
									),
						now,
						options,
						provider: "tmdb",
						store,
						version,
					}),
			})),
		);

		const aligned: SegmentMetadata[] = [];
		let runIndex = 0;
		let segmentInRun = 0;
		const advance = (run: ResourceRun): void => {
			segmentInRun += 1;
			if (segmentInRun >= run.resources.length) {
				runIndex += 1;
				segmentInRun = 0;
			}
		};

		for (const segment of resolved.segments) {
			if (segment.members.tmdb === undefined) {
				aligned.push(emptySegment());
				continue;
			}
			const run = runs[runIndex];
			if (run === undefined) {
				aligned.push(emptySegment());
				continue;
			}
			if (run.kind === "tv") {
				const [head] = run.resources;
				const document =
					head === undefined ? undefined : documents.get(entryKeyOf(head));
				const slice =
					document === undefined
						? []
						: tvSlice(
								document,
								run.seasonOffset ?? 0,
								run.resources.length,
								locale,
							);
				aligned.push(slice[segmentInRun] ?? emptySegment());
				advance(run);
				continue;
			}
			const resource = run.resources[segmentInRun];
			const document =
				resource === undefined
					? undefined
					: documents.get(entryKeyOf(resource));
			aligned.push(
				document === undefined
					? emptySegment()
					: movieSegment(document, locale),
			);
			advance(run);
		}

		const used = resources.flatMap((resource) => {
			const document = documents.get(entryKeyOf(resource));
			return document === undefined ? [] : [document];
		});
		const [identityDocument] = used;
		if (identityDocument === undefined) {
			throw new Error("tmdb: metadata snapshot run is missing");
		}
		const identity = assemble(
			identityDocument.snapshots.core,
			identityDocument.snapshots.volatile,
			locale,
		);
		const movieRun = runs.length === 1 && runs[0]?.kind === "movie";
		return {
			...identity,
			genres: uniqueGenres(used),
			lastUpdatedAt: lastUpdatedIso(used),
			segments: aligned,
			span: movieRun ? yearSpanFromSegments(aligned) : identity.span,
		};
	};

	return { fetchWork };
};

export { createTmdbProvider };
export type { TmdbProviderDeps };
export type { MetadataKv } from "./metadata-kv.ts";
