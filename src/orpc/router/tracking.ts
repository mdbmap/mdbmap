import { and, eq, inArray } from "drizzle-orm";

import type { WatchStatus } from "@/db/schema";
import { episodeProgress, personalRating, watchStatus } from "@/db/schema";
import type { EngineRead } from "@/engine";
import { authed } from "@/orpc/base";
import type { Db } from "@/orpc/context";
import { instalmentsOf } from "@/orpc/instalments";
import type {
	EpisodeWatchedResult,
	RatingResult,
	TrackingSummary,
} from "@/orpc/schema";
import {
	SetEpisodeWatchedInput,
	SetRatingInput,
	SetRewatchInput,
	SetStatusInput,
} from "@/orpc/schema";

// All instalments watched ⇒ completed; any progress ⇒ watching.
const deriveWholeSeriesStatus = (
	db: Db,
	engine: EngineRead,
	userId: string,
	continuityId: string,
): EpisodeWatchedResult => {
	const locators = instalmentsOf(engine.resolveContinuity(continuityId));
	const rows =
		locators.length === 0
			? []
			: db
					.select({ locator: episodeProgress.instalmentLocator })
					.from(episodeProgress)
					.where(
						and(
							eq(episodeProgress.userId, userId),
							inArray(episodeProgress.instalmentLocator, locators),
						),
					)
					.all();
	const watchedSet = new Set(rows.map((row) => row.locator));
	const status: WatchStatus =
		locators.length > 0 && watchedSet.size === locators.length
			? "completed"
			: "watching";
	return { status, watched: [...watchedSet] };
};

const readSummary = (db: Db, userId: string, continuityKey: string) =>
	db
		.select()
		.from(watchStatus)
		.where(
			and(
				eq(watchStatus.userId, userId),
				eq(watchStatus.continuityKey, continuityKey),
			),
		)
		.get();

const setStatus = authed
	.input(SetStatusInput)
	.handler(({ context, input }): TrackingSummary => {
		const userId = context.user.id;
		context.db
			.insert(watchStatus)
			.values({ continuityKey: input.continuityId, status: input.status, userId })
			.onConflictDoUpdate({
				set: { status: input.status },
				target: [watchStatus.userId, watchStatus.continuityKey],
			})
			.run();
		const row = readSummary(context.db, userId, input.continuityId);
		return {
			rewatchCount: row?.rewatchCount ?? 0,
			status: row?.status ?? input.status,
		};
	});

const setRewatch = authed
	.input(SetRewatchInput)
	.handler(({ context, input }): TrackingSummary => {
		const userId = context.user.id;
		context.db
			.insert(watchStatus)
			.values({
				continuityKey: input.continuityId,
				rewatchCount: input.count,
				status: "watching",
				userId,
			})
			.onConflictDoUpdate({
				set: { rewatchCount: input.count },
				target: [watchStatus.userId, watchStatus.continuityKey],
			})
			.run();
		const row = readSummary(context.db, userId, input.continuityId);
		return {
			rewatchCount: row?.rewatchCount ?? input.count,
			status: row?.status,
		};
	});

const setEpisodeWatched = authed
	.input(SetEpisodeWatchedInput)
	.handler(({ context, input }): EpisodeWatchedResult => {
		const userId = context.user.id;
		if (input.watched) {
			context.db
				.insert(episodeProgress)
				.values({ instalmentLocator: input.instalmentLocator, userId })
				.onConflictDoNothing({
					target: [episodeProgress.userId, episodeProgress.instalmentLocator],
				})
				.run();
		} else {
			context.db
				.delete(episodeProgress)
				.where(
					and(
						eq(episodeProgress.userId, userId),
						eq(episodeProgress.instalmentLocator, input.instalmentLocator),
					),
				)
				.run();
		}

		const derived = deriveWholeSeriesStatus(
			context.db,
			context.engine,
			userId,
			input.continuityId,
		);

		context.db
			.insert(watchStatus)
			.values({ continuityKey: input.continuityId, status: derived.status, userId })
			.onConflictDoUpdate({
				set: { status: derived.status },
				target: [watchStatus.userId, watchStatus.continuityKey],
			})
			.run();

		return derived;
	});

const setRating = authed
	.input(SetRatingInput)
	.handler(({ context, input }): RatingResult => {
		const userId = context.user.id;
		if (input.score === undefined) {
			context.db
				.delete(personalRating)
				.where(
					and(
						eq(personalRating.userId, userId),
						eq(personalRating.unitKind, input.unit.kind),
						eq(personalRating.unitKey, input.unit.key),
					),
				)
				.run();
		} else {
			context.db
				.insert(personalRating)
				.values({
					score: input.score,
					unitKey: input.unit.key,
					unitKind: input.unit.kind,
					userId,
				})
				.onConflictDoUpdate({
					set: { score: input.score },
					target: [
						personalRating.userId,
						personalRating.unitKind,
						personalRating.unitKey,
					],
				})
				.run();
		}
		return { score: input.score, unit: input.unit };
	});

const tracking = { setEpisodeWatched, setRating, setRewatch, setStatus };

export { tracking };
