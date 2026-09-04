import { describe, expect, it } from "vitest";

import type { AnilistCatalogueSearch } from "./catalogue-search-anilist.ts";
import type {
	TmdbCatalogueSearch,
	TmdbSearchScope,
} from "./catalogue-search-tmdb.ts";
import { createCatalogueSearchProvider } from "./catalogue-search.ts";
import type { CatalogueSearchHit } from "./types.ts";

const film = (id: string, title: string): CatalogueSearchHit => ({
	catalogue: { id, namespace: "movie", service: "tmdb" },
	coverRef: undefined,
	mediaKind: "film",
	title,
	year: undefined,
});

const anime = (id: string, title: string): CatalogueSearchHit => ({
	catalogue: { id, service: "anilist" },
	coverRef: undefined,
	mediaKind: "anime",
	title,
	year: undefined,
});

describe("createCatalogueSearchProvider unfiltered merge", () => {
	it("interleaves TMDB and AniList hits up to the limit", async () => {
		const anilistHits = [anime("1", "A1"), anime("2", "A2"), anime("3", "A3")];
		const tmdbHits = [film("10", "T1"), film("20", "T2"), film("30", "T3")];
		const anilist: AnilistCatalogueSearch = {
			search: (_query: string): readonly CatalogueSearchHit[] => anilistHits,
		};
		const tmdb: TmdbCatalogueSearch = {
			search: (
				_query: string,
				_scope: TmdbSearchScope,
			): readonly CatalogueSearchHit[] => tmdbHits,
		};
		const provider = createCatalogueSearchProvider({
			anilist,
			limit: 4,
			tmdb,
		});

		const results = await provider.search("query");
		expect(results.map((hit) => hit.title)).toEqual(["T1", "A1", "T2", "A2"]);
	});
});
