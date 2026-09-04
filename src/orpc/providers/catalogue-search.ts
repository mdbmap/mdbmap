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
		const [tmdbHits, anilistHits] = await Promise.all([
			tmdb.search(query, "multi"),
			anilist.search(query),
		]);
		return [...tmdbHits, ...anilistHits].slice(0, limit);
	};

	return { search };
};

const catalogueSearchProvider = createCatalogueSearchProvider();

export { catalogueSearchProvider, createCatalogueSearchProvider };
export type { CatalogueSearchDeps };
