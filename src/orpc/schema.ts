import { z } from "zod";

import type { RateableUnitKind, WatchStatus } from "@/db/schema";
import { watchStatuses } from "@/db/schema";
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

interface RateableUnit {
	key: string;
	kind: RateableUnitKind;
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
	CandidateIdInput,
	ManualPairInput,
	MarkMatchedInput,
	RateableUnitInput,
	SetEpisodeWatchedInput,
	SetRatingInput,
	SetRewatchInput,
	SetStatusInput,
	SettleConflictInput,
	TodoSchema,
	WatchStatusSchema,
	WorkGetInput,
};
export type {
	CommunityScore,
	Credit,
	EpisodeView,
	EpisodeWatchedResult,
	PartView,
	RateableUnit,
	RatingResult,
	ServiceRating,
	Similar,
	TrackingSummary,
	ViewerTracking,
	WorkView,
};
