import { z } from "zod";

import type { CatalogueSearchHit } from "./types.ts";

const DEFAULT_ANILIST_URL = "https://graphql.anilist.co";
const DEFAULT_LIMIT = 20;
const DEFAULT_TIMEOUT_MS = 8000;

interface AnilistSearchDeps {
	baseUrl?: string;
	fetchFn?: typeof fetch;
	limit?: number;
	timeoutMs?: number;
}

const anilistTitleSchema = z.object({
	english: z.string().nullable().optional(),
	romaji: z.string().nullable().optional(),
});

const anilistCoverSchema = z.object({
	large: z.string().nullable().optional(),
	medium: z.string().nullable().optional(),
});

const anilistStartDateSchema = z.object({
	year: z.number().nullable().optional(),
});

const anilistMediaSchema = z.object({
	coverImage: anilistCoverSchema.nullable().optional(),
	id: z.number(),
	seasonYear: z.number().nullable().optional(),
	startDate: anilistStartDateSchema.nullable().optional(),
	title: anilistTitleSchema.nullable().optional(),
});

const anilistPageSchema = z.object({
	media: z.array(anilistMediaSchema.nullable()).nullable().optional(),
});

const anilistDataSchema = z.object({
	Page: anilistPageSchema.nullable().optional(),
});

const anilistSearchResponseSchema = z.object({
	data: anilistDataSchema.optional(),
});

const SEARCH_QUERY =
	"query ($search: String, $perPage: Int) { Page(page: 1, perPage: $perPage) { media(search: $search, type: ANIME, sort: SEARCH_MATCH) { id title { romaji english } seasonYear startDate { year } coverImage { large medium } } } }";

const coverRefOf = (
	cover: z.infer<typeof anilistCoverSchema> | null | undefined,
): string | undefined => {
	if (cover === undefined || cover === null) {
		return undefined;
	}
	const url = cover.large ?? cover.medium;
	if (url === undefined || url === null || url === "") {
		return undefined;
	}
	return url;
};

const titleOf = (
	title: z.infer<typeof anilistTitleSchema> | null | undefined,
): string => {
	if (title === undefined || title === null) {
		return "";
	}
	return title.english ?? title.romaji ?? "";
};

const yearOf = (
	seasonYear: number | null | undefined,
	startYear: number | null | undefined,
): number | undefined => {
	if (seasonYear !== undefined && seasonYear !== null) {
		return seasonYear;
	}
	if (startYear !== undefined && startYear !== null) {
		return startYear;
	}
	return undefined;
};

interface AnilistCatalogueSearch {
	search: (query: string) => Promise<readonly CatalogueSearchHit[]>;
}

const createAnilistCatalogueSearch = (
	deps: AnilistSearchDeps = {},
): AnilistCatalogueSearch => {
	const {
		baseUrl = DEFAULT_ANILIST_URL,
		fetchFn = fetch,
		limit = DEFAULT_LIMIT,
		timeoutMs = DEFAULT_TIMEOUT_MS,
	} = deps;

	const search = async (
		query: string,
	): Promise<readonly CatalogueSearchHit[]> => {
		const response = await fetchFn(baseUrl, {
			body: JSON.stringify({
				query: SEARCH_QUERY,
				variables: { perPage: limit, search: query },
			}),
			headers: { "Content-Type": "application/json" },
			method: "POST",
			signal: AbortSignal.timeout(timeoutMs),
		});
		if (!response.ok) {
			throw new Error(`anilist: ${response.status} for search`);
		}
		const parsed = anilistSearchResponseSchema.safeParse(await response.json());
		if (!parsed.success) {
			return [];
		}
		const media = parsed.data.data?.Page?.media ?? [];
		return media.flatMap((item) => {
			if (item === null) {
				return [];
			}
			const hit: CatalogueSearchHit = {
				catalogue: { id: String(item.id), service: "anilist" },
				coverRef: coverRefOf(item.coverImage),
				mediaKind: "anime",
				title: titleOf(item.title),
				year: yearOf(item.seasonYear, item.startDate?.year),
			};
			return [hit];
		});
	};

	return { search };
};

export { createAnilistCatalogueSearch };
export type { AnilistCatalogueSearch, AnilistSearchDeps };
