import { z } from "zod";

import { presentationOrderSlugs } from "@/db/engine-schema";
import type { ApiKeyPlan, RateableUnitKind, WatchStatus } from "@/db/schema";
import { apiKeyPlans, researchTimings, watchStatuses } from "@/db/schema";
import type { MediaKind } from "@/engine";
import { profileOrder } from "@/engine/identity.ts";
import { isIngestPlannable } from "@/engine/ingest/plannable.ts";
import type { ProviderListItem } from "@/lib/provider-config/store.ts";
import {
	ProviderConfigSchema,
	UpdateProviderConfigSchema,
} from "@/lib/provider-config/types.ts";

const WatchStatusSchema = z.enum(watchStatuses);

const ScoreSchema = z.number().int().min(1).max(10);

// Discriminated per kind so future kinds can carry kind-specific payloads
// without loosening the others; mirrors rateableUnitKinds.
const RateableUnitInput = z.discriminatedUnion("kind", [
	z.object({ key: z.string().min(1), kind: z.literal("work") }),
	z.object({ key: z.string().min(1), kind: z.literal("part") }),
	z.object({ key: z.string().min(1), kind: z.literal("episode") }),
	z.object({ key: z.string().min(1), kind: z.literal("movie") }),
]);

const WorkGetInput = z.object({
	continuityId: z.string().min(1),
	order: z.enum(presentationOrderSlugs).optional(),
	proposalId: z.number().int().min(1).optional(),
});

const SearchQueryInput = z.object({
	mediaKind: z.enum(["anime", "film", "tv"]).optional(),
	query: z.string(),
});

const librarySorts = ["activity", "title", "rating"] as const;
type LibrarySort = (typeof librarySorts)[number];

const LibraryListInput = z.object({
	sort: z.enum(librarySorts).optional(),
	status: WatchStatusSchema.optional(),
});

const SetStatusInput = z.object({
	continuityId: z.string().min(1),
	status: WatchStatusSchema,
});

const SetRewatchInput = z.object({
	continuityId: z.string().min(1),
	count: z.number().int().min(0),
});

const SetEpisodeWatchedInput = z.object({
	continuityId: z.string().trim().min(1),
	instalmentLocator: z.string().trim().min(1),
	watched: z.boolean(),
});

const SetPartWatchedInput = z.object({
	continuityId: z.string().trim().min(1),
	instalmentLocators: z.array(z.string().trim().min(1)).min(1),
	watched: z.boolean(),
});

const SetNoteInput = z.object({
	body: z.string().max(4000),
	continuityId: z.string().min(1),
});

const RemoveTrackingInput = z.object({
	continuityId: z.string().min(1),
});

// Omit `score` (or pass undefined) to clear the rating; the repo avoids null.
const SetRatingInput = z.object({
	score: ScoreSchema.optional(),
	unit: RateableUnitInput,
});

const CandidateIdInput = z.object({
	candidateId: z.number().int().min(1),
});

const SettleConflictInput = z.object({
	accept: z.boolean(),
	candidateId: z.number().int().min(1),
	relationIndex: z.number().int().min(0).optional(),
});

const MarkMatchedInput = z.object({
	groupId: z.number().int().min(1),
});

const ManualPairInput = z.object({
	instalmentIds: z.array(z.number().int().min(1)).min(1),
	unitId: z.uuid().optional(),
});

const ApiKeyPlanSchema = z.enum(apiKeyPlans);

const MintApiKeyInput = z.object({
	label: z.string().trim().min(1).max(200),
	plan: ApiKeyPlanSchema.optional(),
});

const RevokeApiKeyInput = z.object({
	id: z.string().min(1),
});

const ResearchTimingSchema = z.enum(researchTimings);

const CreateProviderInput = z.object({
	config: ProviderConfigSchema,
	label: z.string().trim().min(1).max(200),
});

const UpdateProviderInput = z.object({
	config: UpdateProviderConfigSchema,
	id: z.string().min(1),
	label: z.string().trim().min(1).max(200),
});

const RemoveProviderInput = z.object({
	id: z.string().min(1),
});

const SetResearchTimingInput = z.object({
	timing: ResearchTimingSchema,
});

const numericCatalogueId = z.string().regex(/^\d+$/u);
const imdbCatalogueId = z.string().regex(/^tt\d+$/u);

const CatalogueTitleInput = z.discriminatedUnion("service", [
	z.object({
		id: numericCatalogueId,
		namespace: z.enum(["movie", "tv"]),
		service: z.literal("tmdb"),
	}),
	z.object({ id: numericCatalogueId, service: z.literal("anilist") }),
	z.object({ id: imdbCatalogueId, service: z.literal("imdb") }),
	z.object({ id: numericCatalogueId, service: z.literal("kitsu") }),
	z.object({ id: numericCatalogueId, service: z.literal("mal") }),
	z.object({ id: numericCatalogueId, service: z.literal("tvdb") }),
]);

const IngestStartIdentityInput = z.object({
	kind: z.literal("title"),
	title: CatalogueTitleInput,
});

const IngestStartInput = z
	.object({
		identity: IngestStartIdentityInput,
		profile: z.enum(profileOrder),
	})
	.superRefine((input, ctx) => {
		if (!isIngestPlannable(input.identity, input.profile)) {
			ctx.addIssue({
				code: "custom",
				message: "This identity and profile cannot be ingested.",
				path: ["identity"],
			});
		}
	});

interface RateableUnit {
	key: string;
	kind: RateableUnitKind;
}

interface ApiKeyRow {
	createdAt: Date | null;
	id: string;
	label: string;
	plan: ApiKeyPlan;
	revokedAt: Date | null;
}

interface MintedApiKey extends ApiKeyRow {
	// Present only in the mint response — never re-derivable afterwards.
	secret: string;
}

type ProviderRow = ProviderListItem;

interface ServiceRating {
	kind: "critic" | "user";
	scale: number;
	score: number;
	service: string;
	votes: number;
}

type AdminIngestStartResult =
	| { readonly kind: "complete" }
	| { readonly kind: "conflict"; readonly review: string }
	| {
			readonly kind: "pending";
			readonly retryAfterSeconds: number;
			readonly statusUrl: string;
	  }
	| { readonly kind: "retryable"; readonly retryAfterSeconds: number }
	| { readonly kind: "unknown" };

const WorkOpenInput = IngestStartInput;

type WorkOpenResult =
	| { readonly kind: "conflict"; readonly review: string }
	| {
			readonly continuityId: string;
			readonly kind: "pending";
			readonly retryAfterSeconds: number;
			readonly statusUrl?: string;
	  }
	| { readonly continuityId: string; readonly kind: "ready" }
	| { readonly kind: "unknown" };

interface CommunityScore {
	count: number;
	mean: number | undefined;
}

interface Credit {
	name: string;
	ref: string | undefined;
	role: string;
}

interface Similar {
	continuityId: string;
	coverRef: string | undefined;
	title: string;
}

type CatalogueTitle = z.infer<typeof CatalogueTitleInput>;

interface SearchHit {
	catalogue: CatalogueTitle;
	continuityId: string | undefined;
	coverRef: string | undefined;
	mediaKind: MediaKind;
	title: string;
	year: number | undefined;
}

interface WorkHeader {
	backdropRef: string | undefined;
	coverRef: string | undefined;
	genres: string[];
	nativeTitle: string | undefined;
	productionStatus: string | undefined;
	runtimeMinutes: number | undefined;
	span: string;
	synopsis: string;
	title: string;
}

interface EpisodeView {
	airDate: string | undefined;
	communityScore: CommunityScore;
	instalmentLocator: string;
	number: number;
	personalRating: number | undefined;
	rateableUnit: RateableUnit;
	title: string;
	watched: boolean;
}

interface MovieRateableUnit {
	key: string;
	kind: "movie";
}

interface PartView {
	airDate?: string | undefined;
	airedFrom: string | undefined;
	airedTo: string | undefined;
	communityScore: CommunityScore;
	episodeCount: number;
	episodes: EpisodeView[];
	kind: "part";
	label: string;
	personalRating: number | undefined;
	rateableUnit: RateableUnit;
	serviceRatings: ServiceRating[];
	watched?: boolean;
	year: number | undefined;
}

interface FilmView {
	airDate: string | undefined;
	airedFrom: string | undefined;
	airedTo: string | undefined;
	communityScore: CommunityScore;
	episodeCount: number;
	episodes: EpisodeView[];
	instalmentLocator: string;
	kind: "film";
	label: string;
	personalRating: number | undefined;
	rateableUnit: MovieRateableUnit;
	serviceRatings: ServiceRating[];
	watched: boolean;
	year: number | undefined;
}

type WorkBlock = FilmView | PartView;

interface ViewerTracking {
	note?: string | undefined;
	personalRating: number | undefined;
	rewatchCount: number;
	status: WatchStatus | undefined;
	watched: string[];
}

interface CatalogueLink {
	href: string;
	id: string;
	label: string;
	service: "anidb" | "anilist" | "imdb" | "mal" | "tmdb";
}

interface CommunityOrderRef {
	id: number;
	name: string;
}

interface ProposalSegmentRef {
	id: number;
	label: string;
}

interface WorkView {
	cast: Credit[];
	catalogues: CatalogueLink[];
	communityOrders: CommunityOrderRef[];
	communityScore: CommunityScore;
	continuityId: string;
	header: WorkHeader;
	ifYouLiked: Similar[];
	mediaKind: MediaKind;
	parts: WorkBlock[];
	proposalSegments: ProposalSegmentRef[];
	staff: Credit[];
	studios: string[];
	viewer: ViewerTracking | undefined;
}

interface TrackingSummary {
	rewatchCount: number;
	status: WatchStatus | undefined;
}

interface NoteResult {
	body: string | undefined;
}

interface TrackingRemoveResult {
	removed: true;
}

// `title` and `coverRef` are absent when the metadata provider could not be
// reached for that continuity; the rest of the row still comes from D1.
interface NextUp {
	number: number;
	partLabel: string;
	title: string;
}

interface LibraryEntry {
	continuityId: string;
	coverRef: string | undefined;
	finishedAt: string | undefined;
	nextUp?: NextUp | undefined;
	personalRating: number | undefined;
	rewatchCount: number;
	startedAt: string | undefined;
	status: WatchStatus;
	title: string | undefined;
	totalInstalments: number;
	watchedInstalments: number;
}

interface EpisodeWatchedResult {
	status: WatchStatus;
	watched: string[];
}

interface RatingResult {
	score: number | undefined;
	unit: RateableUnit;
}

export {
	ApiKeyPlanSchema,
	CandidateIdInput,
	CatalogueTitleInput,
	CreateProviderInput,
	IngestStartInput,
	ManualPairInput,
	WorkOpenInput,
	MarkMatchedInput,
	MintApiKeyInput,
	RateableUnitInput,
	RemoveProviderInput,
	RemoveTrackingInput,
	ResearchTimingSchema,
	RevokeApiKeyInput,
	LibraryListInput,
	librarySorts,
	SearchQueryInput,
	SetEpisodeWatchedInput,
	SetPartWatchedInput,
	SetNoteInput,
	SetRatingInput,
	SetResearchTimingInput,
	SetRewatchInput,
	SetStatusInput,
	SettleConflictInput,
	UpdateProviderInput,
	WatchStatusSchema,
	WorkGetInput,
};
export type {
	AdminIngestStartResult,
	ApiKeyRow,
	CatalogueLink,
	CatalogueTitle,
	CommunityScore,
	ProposalSegmentRef,
	CommunityOrderRef,
	Credit,
	EpisodeView,
	EpisodeWatchedResult,
	FilmView,
	LibraryEntry,
	NextUp,
	LibrarySort,
	MintedApiKey,
	MovieRateableUnit,
	NoteResult,
	PartView,
	ProviderRow,
	RateableUnit,
	RatingResult,
	SearchHit,
	ServiceRating,
	Similar,
	TrackingRemoveResult,
	TrackingSummary,
	ViewerTracking,
	WorkBlock,
	WorkOpenResult,
	WorkView,
};
export type { ResearchTiming } from "@/db/schema";
