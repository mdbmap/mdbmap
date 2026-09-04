import { and, eq, inArray } from "drizzle-orm";

import { runAtomicBatch } from "@/db/atomic";
import type { WatchStatus } from "@/db/schema";
import {
	episodeProgress,
	personalRating,
	watchStatus,
	workNote,
} from "@/db/schema";
import type { EngineRead, ResolveResult } from "@/engine";
import { parseContinuityKey } from "@/engine/continuity/keys";
import { retiredContinuityKeys } from "@/engine/continuity/persist";
import { authed } from "@/orpc/base";
import type { Db } from "@/orpc/context";
import { instalmentsOf } from "@/orpc/instalments";
import { persistProgressAndStatus } from "@/orpc/persist-progress";
import type {
	EpisodeWatchedResult,
	NoteResult,
	RateableUnit,
	RatingResult,
	TrackingRemoveResult,
	TrackingSummary,
} from "@/orpc/schema";
import {
	RemoveTrackingInput,
	SetEpisodeWatchedInput,
	SetPartWatchedInput,
	SetNoteInput,
	SetRatingInput,
	SetRewatchInput,
	SetStatusInput,
} from "@/orpc/schema";

// All instalments watched ⇒ completed; any progress ⇒ watching.
const PROGRESS_CHUNK = 50;

const watchedAmong = async (
	db: Db,
	userId: string,
	locators: readonly string[],
): Promise<string[]> => {
	if (locators.length === 0) {
		return [];
	}
	const chunks: string[][] = [];
	for (let offset = 0; offset < locators.length; offset += PROGRESS_CHUNK) {
		chunks.push(locators.slice(offset, offset + PROGRESS_CHUNK));
	}
	const pages = await Promise.all(
		chunks.map(async (chunk) =>
			db
				.select({ locator: episodeProgress.instalmentLocator })
				.from(episodeProgress)
				.where(
					and(
						eq(episodeProgress.userId, userId),
						inArray(episodeProgress.instalmentLocator, chunk),
					),
				)
				.all(),
		),
	);
	return [...new Set(pages.flatMap((rows) => rows.map((row) => row.locator)))];
};

// All instalments watched ⇒ completed; any progress ⇒ watching.
const deriveWholeSeriesStatus = async (
	db: Db,
	engine: EngineRead,
	userId: string,
	continuityId: string,
): Promise<EpisodeWatchedResult> => {
	const locators = [
		...new Set(instalmentsOf(await engine.resolveContinuity(continuityId))),
	];
	const watched = await watchedAmong(db, userId, locators);
	const status: WatchStatus =
		locators.length > 0 && watched.length === locators.length
			? "completed"
			: "watching";
	return { status, watched };
};

const ownedLocators = (
	owned: readonly string[],
	requested: readonly string[],
): string[] => {
	const ownedSet = new Set(owned);
	return [...new Set(requested.filter((locator) => ownedSet.has(locator)))];
};

const persistOwnedProgress = async (
	db: Db,
	engine: EngineRead,
	userId: string,
	continuityId: string,
	owned: readonly string[],
	requested: readonly string[],
	watched: boolean,
): Promise<EpisodeWatchedResult> => {
	const locators = ownedLocators(owned, requested);
	if (locators.length === 0) {
		return deriveWholeSeriesStatus(db, engine, userId, continuityId);
	}
	await persistProgressAndStatus({
		continuityId,
		db,
		locators,
		owned,
		userId,
		watched,
	});
	return deriveWholeSeriesStatus(db, engine, userId, continuityId);
};

const readSummary = async (db: Db, userId: string, continuityKey: string) =>
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

const canonicalContinuityId = async (
	engine: EngineRead,
	requestedId: string,
): Promise<string> => {
	const resolved = await engine.resolveContinuity(requestedId);
	return resolved.continuityId;
};

const isMissingContinuity = (error: unknown): boolean =>
	error instanceof Error && error.message.startsWith("engine: no continuity ");

const resolveOrMissing = async (
	engine: EngineRead,
	requestedId: string,
): Promise<ResolveResult | undefined> => {
	try {
		return await engine.resolveContinuity(requestedId);
	} catch (error) {
		if (isMissingContinuity(error)) {
			return undefined;
		}
		throw error;
	}
};

const watchStatusKeys = async (
	db: Db,
	canonicalId: string,
	requestedId: string,
): Promise<string[]> => {
	const parsed = parseContinuityKey(canonicalId);
	const aliases =
		parsed === undefined ? [] : await retiredContinuityKeys(db, parsed);
	return [...new Set([canonicalId, requestedId, ...aliases])];
};

const noteKeysFor = async (
	db: Db,
	canonicalId: string,
	requestedId: string,
): Promise<readonly string[]> => {
	const parsed = parseContinuityKey(canonicalId);
	const aliases =
		parsed === undefined ? [] : await retiredContinuityKeys(db, parsed);
	return [...new Set([canonicalId, requestedId, ...aliases])];
};

const sqlIn = (values: readonly string[]): string =>
	values.map(() => "?").join(", ");

const deleteTrackingRows = async (
	db: Db,
	userId: string,
	locators: readonly string[],
	keys: readonly string[],
): Promise<void> => {
	await runAtomicBatch(db, (database, operationId) => {
		const statements: D1PreparedStatement[] = [
			database
				.prepare(
					"INSERT INTO atomic_write_gates (operation_id) VALUES (?) RETURNING operation_id",
				)
				.bind(operationId),
		];
		if (locators.length > 0) {
			statements.push(
				database
					.prepare(
						`DELETE FROM episode_progress WHERE user_id = ? AND instalment_locator IN (${sqlIn(locators)})`,
					)
					.bind(userId, ...locators),
			);
		}
		if (keys.length > 0) {
			statements.push(
				database
					.prepare(
						`DELETE FROM watch_status WHERE user_id = ? AND continuity_key IN (${sqlIn(keys)})`,
					)
					.bind(userId, ...keys),
				database
					.prepare(
						`DELETE FROM work_note WHERE user_id = ? AND continuity_key IN (${sqlIn(keys)})`,
					)
					.bind(userId, ...keys),
			);
		}
		statements.push(
			database
				.prepare("DELETE FROM atomic_write_gates WHERE operation_id = ?")
				.bind(operationId),
		);
		const [head, ...rest] = statements;
		if (head === undefined) {
			throw new Error("expected atomic batch statements");
		}
		return [head, ...rest];
	});
};

const TRACKING_REMOVED: TrackingRemoveResult = { removed: true };

const canonicalRateableUnit = async (
	engine: EngineRead,
	unit: RateableUnit,
): Promise<RateableUnit> => {
	if (unit.kind === "work") {
		return {
			key: await canonicalContinuityId(engine, unit.key),
			kind: unit.kind,
		};
	}
	if (unit.kind === "part") {
		const match =
			/^part:(?<requestedId>(?:continuity|group):\d+):(?<index>\d+)$/u.exec(
				unit.key,
			);
		if (match !== null) {
			const { index, requestedId } = match.groups ?? {};
			if (requestedId !== undefined && index !== undefined) {
				const canonicalId = await canonicalContinuityId(engine, requestedId);
				return { key: `part:${canonicalId}:${index}`, kind: unit.kind };
			}
		}
	}
	return unit;
};

const setStatus = authed
	.input(SetStatusInput)
	.handler(async ({ context, input }): Promise<TrackingSummary> => {
		const userId = context.user.id;
		const continuityId = await canonicalContinuityId(
			context.engine,
			input.continuityId,
		);
		await context.db
			.insert(watchStatus)
			.values({ continuityKey: continuityId, status: input.status, userId })
			.onConflictDoUpdate({
				set: { status: input.status },
				target: [watchStatus.userId, watchStatus.continuityKey],
			})
			.run();
		const row = await readSummary(context.db, userId, continuityId);
		return {
			rewatchCount: row?.rewatchCount ?? 0,
			status: row?.status ?? input.status,
		};
	});

const setRewatch = authed
	.input(SetRewatchInput)
	.handler(async ({ context, input }): Promise<TrackingSummary> => {
		const userId = context.user.id;
		const continuityId = await canonicalContinuityId(
			context.engine,
			input.continuityId,
		);
		await context.db
			.insert(watchStatus)
			.values({
				continuityKey: continuityId,
				rewatchCount: input.count,
				status: "watching",
				userId,
			})
			.onConflictDoUpdate({
				set: { rewatchCount: input.count },
				target: [watchStatus.userId, watchStatus.continuityKey],
			})
			.run();
		const row = await readSummary(context.db, userId, continuityId);
		return {
			rewatchCount: row?.rewatchCount ?? input.count,
			status: row?.status,
		};
	});

const setEpisodeWatched = authed
	.input(SetEpisodeWatchedInput)
	.handler(async ({ context, input }): Promise<EpisodeWatchedResult> => {
		const userId = context.user.id;
		const resolved = await context.engine.resolveContinuity(input.continuityId);
		const { continuityId } = resolved;
		return persistOwnedProgress(
			context.db,
			context.engine,
			userId,
			continuityId,
			instalmentsOf(resolved),
			[input.instalmentLocator],
			input.watched,
		);
	});

const setPartWatched = authed
	.input(SetPartWatchedInput)
	.handler(async ({ context, input }): Promise<EpisodeWatchedResult> => {
		const userId = context.user.id;
		const resolved = await context.engine.resolveContinuity(input.continuityId);
		const { continuityId } = resolved;
		return persistOwnedProgress(
			context.db,
			context.engine,
			userId,
			continuityId,
			instalmentsOf(resolved),
			input.instalmentLocators,
			input.watched,
		);
	});

const setRating = authed
	.input(SetRatingInput)
	.handler(async ({ context, input }): Promise<RatingResult> => {
		const userId = context.user.id;
		const unit = await canonicalRateableUnit(context.engine, input.unit);
		await (
			input.score === undefined
				? context.db
						.delete(personalRating)
						.where(
							and(
								eq(personalRating.userId, userId),
								eq(personalRating.unitKind, unit.kind),
								eq(personalRating.unitKey, unit.key),
							),
						)
				: context.db
						.insert(personalRating)
						.values({
							score: input.score,
							unitKey: unit.key,
							unitKind: unit.kind,
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
		).run();
		return { score: input.score, unit };
	});

const remove = authed
	.input(RemoveTrackingInput)
	.handler(async ({ context, input }): Promise<TrackingRemoveResult> => {
		const userId = context.user.id;
		const requestedId = input.continuityId;
		const resolved = await resolveOrMissing(context.engine, requestedId);
		if (resolved === undefined) {
			await deleteTrackingRows(context.db, userId, [], [requestedId]);
			return TRACKING_REMOVED;
		}
		await deleteTrackingRows(
			context.db,
			userId,
			instalmentsOf(resolved),
			await watchStatusKeys(context.db, resolved.continuityId, requestedId),
		);
		return TRACKING_REMOVED;
	});

const setNote = authed
	.input(SetNoteInput)
	.handler(async ({ context, input }): Promise<NoteResult> => {
		const userId = context.user.id;
		const continuityId = await canonicalContinuityId(
			context.engine,
			input.continuityId,
		);
		const body = input.body.trim();
		const keys = await noteKeysFor(
			context.db,
			continuityId,
			input.continuityId,
		);
		if (body === "") {
			await context.db
				.delete(workNote)
				.where(
					and(
						eq(workNote.userId, userId),
						inArray(workNote.continuityKey, keys),
					),
				)
				.run();
			return { body: undefined };
		}
		const retired = keys.filter((key) => key !== continuityId);
		await context.db
			.insert(workNote)
			.values({ body, continuityKey: continuityId, userId })
			.onConflictDoUpdate({
				set: { body },
				target: [workNote.userId, workNote.continuityKey],
			})
			.run();
		if (retired.length > 0) {
			await context.db
				.delete(workNote)
				.where(
					and(
						eq(workNote.userId, userId),
						inArray(workNote.continuityKey, retired),
					),
				)
				.run();
		}
		return { body };
	});

const tracking = {
	remove,
	setEpisodeWatched,
	setNote,
	setPartWatched,
	setRating,
	setRewatch,
	setStatus,
};

export { tracking };
