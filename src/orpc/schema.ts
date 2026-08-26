import { z } from "zod";

import type { ApiKeyPlan, LlmProviderKind, RateableUnitKind, WatchStatus } from "@/db/schema";
import { apiKeyPlans, researchTimings, watchStatuses } from "@/db/schema";
import {
	ProviderConfigSchema,
	UpdateProviderConfigSchema,
} from "@/lib/provider-config/types";
import type { ProviderPublicConfig } from "@/lib/provider-config/types";
import type { MediaKind } from "@/engine";

const TodoSchema = z.object({
	id: z.number().int().min(1),
	name: z.string(),
});

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

const WorkGetInput = z.object({ continuityId: z.string().min(1) });

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

interface ProviderRow {
	config: ProviderPublicConfig;
	id: string;
	kind: LlmProviderKind;
	label: string;
}

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

interface PartView {
	airedFrom: string | undefined;
	airedTo: string | undefined;
	communityScore: CommunityScore;
	episodeCount: number;
	episodes: EpisodeView[];
	label: string;
	personalRating: number | undefined;
	rateableUnit: RateableUnit;
	serviceRatings: ServiceRating[];
	year: number | undefined;
}

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
	parts: PartView[];
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
	TodoSchema,
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
	MintedApiKey,
	PartView,
	ProviderRow,
	RateableUnit,
	RatingResult,
	ServiceRating,
	Similar,
	TrackingSummary,
	ViewerTracking,
	WorkView,
};
export type { ResearchTiming } from "@/db/schema";

