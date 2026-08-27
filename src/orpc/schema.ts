import { z } from "zod";

import { presentationOrderSlugs } from "@/db/engine-schema";
import type { ApiKeyPlan, RateableUnitKind, WatchStatus } from "@/db/schema";
import { apiKeyPlans, researchTimings, watchStatuses } from "@/db/schema";
import type { MediaKind } from "@/engine";
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
	continuityId: z.string().min(1),
	instalmentLocator: z.string().min(1),
	watched: z.boolean(),
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
	scale: number;
	score: number;
	service: string;
	votes: number;
}

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

interface WorkHeader {
	backdropRef: string | undefined;
	coverRef: string | undefined;
	nativeTitle: string | undefined;
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
	personalRating: number | undefined;
	rewatchCount: number;
	status: WatchStatus | undefined;
	watched: string[];
}

interface WorkView {
	cast: Credit[];
	continuityId: string;
	header: WorkHeader;
	ifYouLiked: Similar[];
	mediaKind: MediaKind;
	parts: WorkBlock[];
	staff: Credit[];
	studios: string[];
	viewer: ViewerTracking | undefined;
}

interface TrackingSummary {
	rewatchCount: number;
	status: WatchStatus | undefined;
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
	CreateProviderInput,
	ManualPairInput,
	MarkMatchedInput,
	MintApiKeyInput,
	RateableUnitInput,
	RemoveProviderInput,
	ResearchTimingSchema,
	RevokeApiKeyInput,
	SetEpisodeWatchedInput,
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
	ApiKeyRow,
	CommunityScore,
	Credit,
	EpisodeView,
	EpisodeWatchedResult,
	FilmView,
	MintedApiKey,
	MovieRateableUnit,
	PartView,
	ProviderRow,
	RateableUnit,
	RatingResult,
	ServiceRating,
	Similar,
	TrackingSummary,
	ViewerTracking,
	WorkBlock,
	WorkView,
};
export type { ResearchTiming } from "@/db/schema";
