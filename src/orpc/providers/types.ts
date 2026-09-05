import type {
	MediaKind,
	MemberTitles,
	MetadataProvider as MetadataProviderKind,
	ResolveResult,
} from "@/engine";
import type { Db } from "@/orpc/context";
import type {
	CatalogueTitle,
	CommunityScore,
	Credit,
	RateableUnit,
	ServiceRating,
	Similar,
} from "@/orpc/schema";

import type { MetadataFetchOptions } from "./metadata-freshness.ts";
import type { LocalizedTitle } from "./metadata-locale.ts";

interface EpisodeMetadata {
	airDate: string | undefined;
	number: number;
	title: string;
	titles?: readonly LocalizedTitle[];
}

interface SegmentMetadata {
	airedFrom: string | undefined;
	airedTo: string | undefined;
	episodes: readonly EpisodeMetadata[];
	label: string | undefined;
	year: number | undefined;
}

interface WorkMetadata {
	backdropRef: string | undefined;
	cast: readonly Credit[];
	coverRef: string | undefined;
	genres: readonly string[];
	ifYouLiked: readonly Similar[];
	lastUpdatedAt?: string | undefined;
	nativeTitle: string | undefined;
	productionStatus: string | undefined;
	runtimeMinutes: number | undefined;
	segments: readonly SegmentMetadata[];
	span: string;
	staff: readonly Credit[];
	studios: readonly string[];
	synopsis: string;
	tagline?: string | undefined;
	title: string;
}

// Display metadata for one media kind. Real impls persist TMDB/AniDB snapshots
// in D1 (ADR-0010); segments align index-for-index with the engine's segments.
interface MetadataProvider {
	fetchWork: (
		resolved: ResolveResult,
		options?: MetadataFetchOptions,
	) => Promise<WorkMetadata>;
}

type MetadataRegistry = Readonly<
	Record<MetadataProviderKind, MetadataProvider>
>;

// External per-service ratings, never merged (#7). Keyed by rateable unit and
// driven by the unit's resolved member ids. Async because the live per-service
// fetch is the engine's unblock; the member titles are threaded at the call
// site, mirroring how the db is threaded into the community provider.
interface ServiceRatingsProvider {
	ratingsFor: (
		unit: RateableUnit,
		members: MemberTitles,
	) => Promise<readonly ServiceRating[]>;
}

// mdbmap's own mean + count over personal ratings (#8). Async because it
// queries D1; the request-scoped db is threaded in at the call site.
interface CommunityScoreProvider {
	scoreFor: (
		unit: RateableUnit,
		db: Db,
		aliases?: readonly RateableUnit[],
	) => Promise<CommunityScore>;
}

interface CatalogueSearchHit {
	catalogue: CatalogueTitle;
	coverRef: string | undefined;
	mediaKind: MediaKind;
	title: string;
	year: number | undefined;
}

interface CatalogueSearchOptions {
	mediaKind?: MediaKind;
}

interface CatalogueSearchProvider {
	search: (
		query: string,
		options?: CatalogueSearchOptions,
	) => Promise<readonly CatalogueSearchHit[]>;
}

interface Providers {
	catalogueSearch: CatalogueSearchProvider;
	community: CommunityScoreProvider;
	metadata: MetadataRegistry;
	serviceRatings: ServiceRatingsProvider;
}

export type {
	CatalogueSearchHit,
	CatalogueSearchOptions,
	CatalogueSearchProvider,
	CommunityScoreProvider,
	EpisodeMetadata,
	MetadataProvider,
	MetadataRegistry,
	Providers,
	SegmentMetadata,
	ServiceRatingsProvider,
	WorkMetadata,
};
export type { MetadataFetchOptions } from "./metadata-freshness.ts";
