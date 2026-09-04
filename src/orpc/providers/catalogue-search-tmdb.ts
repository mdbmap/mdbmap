import { z } from "zod";

import type { CatalogueSearchHit } from "./types.ts";

const DEFAULT_BASE_URL = "https://api.themoviedb.org/3";
const YEAR_LENGTH = 4;
const DEFAULT_LIMIT = 20;

interface TmdbSearchDeps {
	apiKey: string | undefined;
	baseUrl?: string;
	fetchFn?: typeof fetch;
	limit?: number;
}

const tmdbSearchItemSchema = z.object({
	first_air_date: z.string().optional(),
	id: z.number(),
	media_type: z.enum(["movie", "tv", "person"]).optional(),
	name: z.string().optional(),
	poster_path: z.string().optional(),
	release_date: z.string().optional(),
	title: z.string().optional(),
});

const tmdbSearchResponseSchema = z.object({
	results: z.array(tmdbSearchItemSchema).optional(),
});

type TmdbSearchItem = z.infer<typeof tmdbSearchItemSchema>;

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

const toMovieHit = (item: TmdbSearchItem): CatalogueSearchHit => ({
	catalogue: {
		id: String(item.id),
		namespace: "movie",
		service: "tmdb",
	},
	coverRef: imageRef(item.poster_path),
	mediaKind: "film",
	title: item.title ?? item.name ?? "",
	year: yearOf(item.release_date),
});

const toTvHit = (item: TmdbSearchItem): CatalogueSearchHit => ({
	catalogue: {
		id: String(item.id),
		namespace: "tv",
		service: "tmdb",
	},
	coverRef: imageRef(item.poster_path),
	mediaKind: "tv",
	title: item.name ?? item.title ?? "",
	year: yearOf(item.first_air_date),
});

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

type TmdbSearchScope = "movie" | "multi" | "tv";

const searchPath = (scope: TmdbSearchScope, query: string): string => {
	const encoded = encodeURIComponent(query);
	switch (scope) {
		case "movie": {
			return `/search/movie?query=${encoded}`;
		}
		case "tv": {
			return `/search/tv?query=${encoded}`;
		}
		case "multi": {
			return `/search/multi?query=${encoded}`;
		}
	}
};

const mapResults = (
	scope: TmdbSearchScope,
	items: readonly TmdbSearchItem[],
	limit: number,
): CatalogueSearchHit[] => {
	const hits: CatalogueSearchHit[] = [];
	for (const item of items) {
		if (hits.length >= limit) {
			break;
		}
		if (scope === "movie") {
			hits.push(toMovieHit(item));
			continue;
		}
		if (scope === "tv") {
			hits.push(toTvHit(item));
			continue;
		}
		if (item.media_type === "movie") {
			hits.push(toMovieHit(item));
			continue;
		}
		if (item.media_type === "tv") {
			hits.push(toTvHit(item));
		}
	}
	return hits;
};

interface TmdbCatalogueSearch {
	search: (
		query: string,
		scope: TmdbSearchScope,
	) => Promise<readonly CatalogueSearchHit[]>;
}

const createTmdbCatalogueSearch = (
	deps: TmdbSearchDeps,
): TmdbCatalogueSearch => {
	const {
		apiKey,
		baseUrl = DEFAULT_BASE_URL,
		fetchFn = fetch,
		limit = DEFAULT_LIMIT,
	} = deps;
	const http: HttpContext = { apiKey, baseUrl, fetchFn };

	const search = async (
		query: string,
		scope: TmdbSearchScope,
	): Promise<readonly CatalogueSearchHit[]> => {
		const response = await getJson(
			http,
			searchPath(scope, query),
			tmdbSearchResponseSchema,
		);
		return mapResults(scope, response.results ?? [], limit);
	};

	return { search };
};

export { createTmdbCatalogueSearch };
export type { TmdbCatalogueSearch, TmdbSearchDeps, TmdbSearchScope };
