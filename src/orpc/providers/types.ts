import type { MetadataProvider as MetadataProviderKind, ResolveResult } from "@/engine";
import type { Db } from "@/orpc/context";
import type {
	CommunityScore,
	Credit,
	RateableUnit,
	ServiceRating,
	Similar,
} from "@/orpc/schema";

interface EpisodeMetadata {
	airDate: string | undefined;
	number: number;
	title: string;
}

interface SegmentMetadata {
	airedFrom: string | undefined;
	airedTo: string | undefined;
	episodes: readonly EpisodeMetadata[];
	label: string;
	year: number | undefined;
}

interface WorkMetadata {
	backdropRef: string | undefined;
	cast: readonly Credit[];
	coverRef: string | undefined;
	ifYouLiked: readonly Similar[];
	nativeTitle: string | undefined;
	segments: readonly SegmentMetadata[];
	span: string;
	staff: readonly Credit[];
	studios: readonly string[];
	synopsis: string;
	title: string;
}

// Display metadata for one media kind. Real impls (#5 TMDB, #6 AniDB) fetch the
// resolved members from their service and snapshot to KV; segments align
// index-for-index with the engine's segments. Async because a snapshot miss
// hits the upstream service.
interface MetadataProvider {
	fetchWork: (resolved: ResolveResult) => Promise<WorkMetadata>;
}

type MetadataRegistry = Readonly<Record<MetadataProviderKind, MetadataProvider>>;

// External per-service ratings, never merged (#7). Keyed by rateable unit.
interface ServiceRatingsProvider {
	ratingsFor: (unit: RateableUnit) => readonly ServiceRating[];
}

// mdbmap's own mean + count over personal ratings (#8). Async because it
// queries D1; the request-scoped db is threaded in at the call site.
interface CommunityScoreProvider {
	scoreFor: (unit: RateableUnit, db: Db) => Promise<CommunityScore>;
}

interface Providers {
	community: CommunityScoreProvider;
	metadata: MetadataRegistry;
	serviceRatings: ServiceRatingsProvider;
}

export type {
	CommunityScoreProvider,
	EpisodeMetadata,
	MetadataProvider,
	MetadataRegistry,
	Providers,
	SegmentMetadata,
	ServiceRatingsProvider,
	WorkMetadata,
};
