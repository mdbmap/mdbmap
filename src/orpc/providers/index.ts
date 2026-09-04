import { catalogueSearchProvider } from "./catalogue-search.ts";
import { communityScoreProvider } from "./community.ts";
import { metadataRegistry } from "./metadata.ts";
import { serviceRatingsProvider } from "./service-ratings.ts";
import type { Providers } from "./types.ts";

const defaultProviders: Providers = {
	catalogueSearch: catalogueSearchProvider,
	community: communityScoreProvider,
	metadata: metadataRegistry,
	serviceRatings: serviceRatingsProvider,
};

export { defaultProviders };
export { createCatalogueSearchProvider } from "./catalogue-search.ts";
export { createServiceRatingsProvider } from "./service-ratings.ts";
export type {
	CatalogueSearchHit,
	CatalogueSearchOptions,
	CatalogueSearchProvider,
	CommunityScoreProvider,
	MetadataProvider,
	MetadataRegistry,
	Providers,
	ServiceRatingsProvider,
	WorkMetadata,
} from "./types.ts";
