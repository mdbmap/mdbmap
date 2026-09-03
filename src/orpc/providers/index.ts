import { communityScoreProvider } from "./community.ts";
import { metadataRegistry } from "./metadata.ts";
import { serviceRatingsProvider } from "./service-ratings.ts";
import type { Providers } from "./types.ts";

const defaultProviders: Providers = {
	community: communityScoreProvider,
	metadata: metadataRegistry,
	serviceRatings: serviceRatingsProvider,
};

export { defaultProviders };
export { createServiceRatingsProvider } from "./service-ratings.ts";
export type {
	CommunityScoreProvider,
	MetadataProvider,
	MetadataRegistry,
	Providers,
	ServiceRatingsProvider,
	WorkMetadata,
} from "./types.ts";
