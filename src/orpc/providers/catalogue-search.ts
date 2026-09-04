import type { MediaKind } from "@/engine";
import { env } from "@/env";

import { createAnilistCatalogueSearch } from "./catalogue-search-anilist.ts";
import { createTmdbCatalogueSearch } from "./catalogue-search-tmdb.ts";
import type { CatalogueSearchHit, CatalogueSearchProvider } from "./types.ts";

const DEFAULT_LIMIT = 20;

interface CatalogueSearchDeps {
	anilist?: ReturnType<typeof createAnilistCatalogueSearch>;
	limit?: number;
	tmdb?: ReturnType<typeof createTmdbCatalogueSearch>;
}

const interleave = (
	left: readonly CatalogueSearchHit[],
	right: readonly CatalogueSearchHit[],
	limit: number,
): CatalogueSearchHit[] => {
	const merged: CatalogueSearchHit[] = [];
	const max = Math.max(left.length, right.length);
	for (let index = 0; index < max && merged.length < limit; index += 1) {
		const fromLeft = left[index];
		if (fromLeft !== undefined && merged.length < limit) {
			merged.push(fromLeft);
		}
		const fromRight = right[index];
		if (fromRight !== undefined && merged.length < limit) {
			merged.push(fromRight);
		}
	}
	return merged;
};

const settledHits = (
	result: PromiseSettledResult<readonly CatalogueSearchHit[]>,
	label: string,
): readonly CatalogueSearchHit[] => {
	if (result.status === "fulfilled") {
		return result.value;
	}
	console.error(`catalogue-search: ${label} failed`, result.reason);
	return [];
};

const createCatalogueSearchProvider = (
	deps: CatalogueSearchDeps = {},
): CatalogueSearchProvider => {
	const limit = deps.limit ?? DEFAULT_LIMIT;
	const tmdb =
		deps.tmdb ??
		createTmdbCatalogueSearch({
			apiKey: env.TMDB_API_KEY,
			limit,
		});
	const anilist = deps.anilist ?? createAnilistCatalogueSearch({ limit });

	const search = async (
		query: string,
		options?: { mediaKind?: MediaKind },
	): Promise<readonly CatalogueSearchHit[]> => {
		const mediaKind = options?.mediaKind;
		if (mediaKind === "anime") {
			return anilist.search(query);
		}
		if (mediaKind === "film") {
			return tmdb.search(query, "movie");
		}
		if (mediaKind === "tv") {
			return tmdb.search(query, "tv");
		}
		const [tmdbResult, anilistResult] = await Promise.allSettled([
			tmdb.search(query, "multi"),
			anilist.search(query),
		]);
		return interleave(
			settledHits(tmdbResult, "tmdb"),
			settledHits(anilistResult, "anilist"),
			limit,
		);
	};

	return { search };
};

const catalogueSearchProvider = createCatalogueSearchProvider();

export { catalogueSearchProvider, createCatalogueSearchProvider };
export type { CatalogueSearchDeps };
