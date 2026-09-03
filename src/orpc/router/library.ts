import { and, desc, eq, inArray } from "drizzle-orm";

import { episodeProgress, personalRating, watchStatus } from "@/db/schema";
import type { EngineRead, ResolveResult } from "@/engine";
import { metadataProviderFor } from "@/engine";
import { parseContinuityKey } from "@/engine/continuity/keys";
import { retiredContinuityKeys } from "@/engine/continuity/persist";
import { authed } from "@/orpc/base";
import type { Db } from "@/orpc/context";
import { instalmentsOf } from "@/orpc/instalments";
import type { Providers, WorkMetadata } from "@/orpc/providers";
import type { LibraryEntry } from "@/orpc/schema";

type WatchStatusRow = typeof watchStatus.$inferSelect;

interface TrackedContinuity {
	readonly locators: readonly string[];
	readonly resolved: ResolveResult;
	readonly row: WatchStatusRow;
}

// A watch-status row whose continuity was merged away resolves to the survivor,
// so the newest row for each survivor wins and the retired duplicate is dropped.
const trackedContinuities = async (
	engine: EngineRead,
	rows: readonly WatchStatusRow[],
): Promise<TrackedContinuity[]> => {
	const settled = await Promise.all(
		rows.map(async (row): Promise<TrackedContinuity | undefined> => {
			try {
				const resolved = await engine.resolveContinuity(row.continuityKey);
				return { locators: instalmentsOf(resolved), resolved, row };
			} catch {
				return undefined;
			}
		}),
	);
	const bySurvivor = new Map<string, TrackedContinuity>();
	for (const tracked of settled) {
		if (
			tracked !== undefined &&
			!bySurvivor.has(tracked.resolved.continuityId)
		) {
			bySurvivor.set(tracked.resolved.continuityId, tracked);
		}
	}
	return [...bySurvivor.values()];
};

const watchedLocators = async (
	db: Db,
	userId: string,
	tracked: readonly TrackedContinuity[],
): Promise<ReadonlySet<string>> => {
	const locators = [
		...new Set(tracked.flatMap((entry) => [...entry.locators])),
	];
	if (locators.length === 0) {
		return new Set();
	}
	const rows = await db
		.select({ locator: episodeProgress.instalmentLocator })
		.from(episodeProgress)
		.where(
			and(
				eq(episodeProgress.userId, userId),
				inArray(episodeProgress.instalmentLocator, locators),
			),
		)
		.all();
	return new Set(rows.map((row) => row.locator));
};

const workRatings = async (
	db: Db,
	userId: string,
): Promise<ReadonlyMap<string, number>> => {
	const rows = await db
		.select({ score: personalRating.score, unitKey: personalRating.unitKey })
		.from(personalRating)
		.where(
			and(
				eq(personalRating.userId, userId),
				eq(personalRating.unitKind, "work"),
			),
		)
		.all();
	return new Map(rows.map((row) => [row.unitKey, row.score]));
};

const ratingFor = async (
	db: Db,
	ratings: ReadonlyMap<string, number>,
	tracked: TrackedContinuity,
): Promise<number | undefined> => {
	const canonicalId = tracked.resolved.continuityId;
	const direct =
		ratings.get(canonicalId) ?? ratings.get(tracked.row.continuityKey);
	if (direct !== undefined || ratings.size === 0) {
		return direct;
	}
	const parsed = parseContinuityKey(canonicalId);
	if (parsed === undefined) {
		return undefined;
	}
	const aliasKeys = await retiredContinuityKeys(db, parsed);
	for (const key of aliasKeys) {
		const score = ratings.get(key);
		if (score !== undefined) {
			return score;
		}
	}
	return undefined;
};

// One unreachable metadata provider must not blank the whole library, so a
// failed fetch leaves that row untitled instead of rejecting the list.
const workMetadata = async (
	providers: Providers,
	resolved: ResolveResult,
): Promise<WorkMetadata | undefined> => {
	try {
		return await providers.metadata[
			metadataProviderFor(resolved.mediaKind)
		].fetchWork(resolved);
	} catch {
		return undefined;
	}
};

const toEntry = async (
	db: Db,
	providers: Providers,
	ratings: ReadonlyMap<string, number>,
	watched: ReadonlySet<string>,
	tracked: TrackedContinuity,
): Promise<LibraryEntry> => {
	const [metadata, rating] = await Promise.all([
		workMetadata(providers, tracked.resolved),
		ratingFor(db, ratings, tracked),
	]);
	return {
		continuityId: tracked.resolved.continuityId,
		coverRef: metadata?.coverRef,
		personalRating: rating,
		rewatchCount: tracked.row.rewatchCount,
		status: tracked.row.status,
		title: metadata?.title,
		totalInstalments: tracked.locators.length,
		watchedInstalments: tracked.locators.filter((locator) =>
			watched.has(locator),
		).length,
	};
};

const list = authed.handler(async ({ context }): Promise<LibraryEntry[]> => {
	const userId = context.user.id;
	const rows = await context.db
		.select()
		.from(watchStatus)
		.where(eq(watchStatus.userId, userId))
		.orderBy(desc(watchStatus.updatedAt), desc(watchStatus.id))
		.all();
	const tracked = await trackedContinuities(context.engine, rows);
	const [watched, ratings] = await Promise.all([
		watchedLocators(context.db, userId, tracked),
		workRatings(context.db, userId),
	]);
	return Promise.all(
		tracked.map(async (entry) =>
			toEntry(context.db, context.providers, ratings, watched, entry),
		),
	);
});

const library = { list };

export { library };
