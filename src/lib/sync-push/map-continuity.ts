import type {
	RateableUnitKind,
	SyncAccountProvider,
	WatchStatus,
} from "@/db/schema";
import type { MemberTitles, ResolveResult } from "@/engine";

import { mapScore, mapWatchStatus } from "./scale.ts";
import type {
	ProgressWrite,
	RatingWrite,
	StatusWrite,
	TargetWriteBatch,
	UnmappedWarning,
} from "./types.ts";

interface TrackingSnapshot {
	readonly episodeWatched: ReadonlySet<string>;
	readonly ratings: readonly {
		readonly score: number;
		readonly unitKey: string;
		readonly unitKind: RateableUnitKind;
	}[];
	readonly status: WatchStatus | undefined;
}

interface MapContinuityInput {
	readonly continuityId: string;
	readonly providers: readonly SyncAccountProvider[];
	readonly resolved: ResolveResult;
	readonly tracking: TrackingSnapshot;
}

interface MappedTarget {
	readonly batch: TargetWriteBatch;
	readonly provider: SyncAccountProvider;
}

interface MapContinuityResult {
	readonly targets: readonly MappedTarget[];
	readonly warnings: readonly UnmappedWarning[];
}

interface MutableBatch {
	progress: ProgressWrite[];
	ratings: RatingWrite[];
	status: StatusWrite[];
}

const memberIdFor = (
	members: MemberTitles,
	provider: SyncAccountProvider,
): string | undefined => {
	if (provider === "anilist") {
		return members.anilist;
	}
	if (provider === "mal") {
		return members.mal;
	}
	return undefined;
};

const unsupportedReason = (
	provider: SyncAccountProvider,
): UnmappedWarning["reason"] =>
	provider === "simkl" || provider === "trakt"
		? "unsupported_provider_mapping"
		: "no_member_title";

const batchHasWrites = (batch: MutableBatch): boolean =>
	batch.progress.length > 0 ||
	batch.ratings.length > 0 ||
	batch.status.length > 0;

const warnUnknownLocators = (
	continuityId: string,
	resolved: ResolveResult,
	tracking: TrackingSnapshot,
): UnmappedWarning[] => {
	const knownLocators = new Set(
		resolved.segments.flatMap((segment) => [...segment.instalments]),
	);
	const candidateLocators = new Set(tracking.episodeWatched);
	for (const rating of tracking.ratings) {
		if (rating.unitKind === "episode" || rating.unitKind === "movie") {
			candidateLocators.add(rating.unitKey);
		}
	}
	return [...candidateLocators]
		.filter((locator) => !knownLocators.has(locator))
		.map((locator) => ({
			continuityId,
			instalmentLocator: locator,
			kind: "instalment" as const,
			reason: "unmapped_instalment" as const,
		}));
};

const appendLocatorWrites = (
	batch: MutableBatch,
	provider: SyncAccountProvider,
	externalTitleId: string,
	offset: number,
	locator: string,
	tracking: TrackingSnapshot,
): void => {
	if (tracking.episodeWatched.has(locator)) {
		batch.progress.push({
			episode: offset + 1,
			externalTitleId,
			watched: true,
		});
	}

	for (const rating of tracking.ratings) {
		if (rating.unitKey !== locator) {
			continue;
		}
		if (rating.unitKind === "episode") {
			batch.ratings.push({
				episode: offset + 1,
				externalTitleId,
				score: mapScore(provider, rating.score),
				unit: "episode",
			});
		} else if (rating.unitKind === "movie") {
			batch.ratings.push({
				externalTitleId,
				score: mapScore(provider, rating.score),
				unit: "title",
			});
		}
	}
};

const appendSegmentWrites = (
	batch: MutableBatch,
	warnings: UnmappedWarning[],
	provider: SyncAccountProvider,
	input: MapContinuityInput,
): void => {
	for (const [segmentIndex, segment] of input.resolved.segments.entries()) {
		const externalTitleId = memberIdFor(segment.members, provider);
		if (externalTitleId === undefined) {
			warnings.push({
				continuityId: input.continuityId,
				kind: "segment",
				provider,
				reason: unsupportedReason(provider),
				segmentIndex,
			});
			continue;
		}

		if (input.tracking.status !== undefined) {
			batch.status.push({
				externalTitleId,
				status: mapWatchStatus(input.tracking.status),
			});
		}

		for (const [offset, locator] of segment.instalments.entries()) {
			appendLocatorWrites(
				batch,
				provider,
				externalTitleId,
				offset,
				locator,
				input.tracking,
			);
		}

		const partKey = `part:${input.continuityId}:${segmentIndex}`;
		for (const rating of input.tracking.ratings) {
			if (rating.unitKind === "part" && rating.unitKey === partKey) {
				batch.ratings.push({
					externalTitleId,
					score: mapScore(provider, rating.score),
					unit: "title",
				});
			}
		}
	}
};

const appendWorkRating = (
	batch: MutableBatch,
	warnings: UnmappedWarning[],
	provider: SyncAccountProvider,
	input: MapContinuityInput,
): void => {
	const workRating = input.tracking.ratings.find(
		(rating) =>
			rating.unitKind === "work" && rating.unitKey === input.continuityId,
	);
	if (workRating === undefined) {
		return;
	}

	const firstMapped = input.resolved.segments
		.map((segment) => memberIdFor(segment.members, provider))
		.find((id) => id !== undefined);
	if (firstMapped === undefined) {
		warnings.push({
			continuityId: input.continuityId,
			kind: "rating_unit",
			provider,
			reason: unsupportedReason(provider),
		});
		return;
	}

	batch.ratings.push({
		externalTitleId: firstMapped,
		score: mapScore(provider, workRating.score),
		unit: "title",
	});
};

const mapContinuity = (input: MapContinuityInput): MapContinuityResult => {
	const warnings = warnUnknownLocators(
		input.continuityId,
		input.resolved,
		input.tracking,
	);
	const batches = new Map<SyncAccountProvider, MutableBatch>();
	for (const provider of input.providers) {
		batches.set(provider, { progress: [], ratings: [], status: [] });
	}

	for (const provider of input.providers) {
		const batch = batches.get(provider);
		if (batch === undefined) {
			continue;
		}
		appendSegmentWrites(batch, warnings, provider, input);
		appendWorkRating(batch, warnings, provider, input);
	}

	return {
		targets: input.providers.flatMap((provider) => {
			const batch = batches.get(provider);
			if (batch === undefined || !batchHasWrites(batch)) {
				return [];
			}
			return [
				{
					batch: {
						progress: batch.progress,
						ratings: batch.ratings,
						status: batch.status,
					},
					provider,
				},
			];
		}),
		warnings,
	};
};

export { mapContinuity };
export type { MapContinuityInput, MapContinuityResult, TrackingSnapshot };
