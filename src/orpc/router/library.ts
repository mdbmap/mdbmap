import { and, desc, eq } from "drizzle-orm";

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
	readonly activityAt: Date | undefined;
	readonly locators: readonly string[];
	readonly resolved: ResolveResult;
	readonly row: WatchStatusRow;
}

const rowActivity = (row: WatchStatusRow): number =>
	row.updatedAt?.getTime() ?? row.id;

const preferStatusRow = (
	canonicalId: string,
	group: readonly TrackedContinuity[],
): WatchStatusRow => {
	for (const entry of group) {
		if (entry.row.continuityKey === canonicalId) {
			return entry.row;
		}
	}
	let best = group[0]?.row;
	if (best === undefined) {
		throw new Error("expected at least one watch-status row");
	}
	for (const entry of group) {
		if (rowActivity(entry.row) > rowActivity(best)) {
			best = entry.row;
		}
	}
	return best;
};

const resolveTrackedRow = async (
	engine: EngineRead,
	row: WatchStatusRow,
): Promise<TrackedContinuity | undefined> => {
	try {
		const resolved = await engine.resolveContinuity(row.continuityKey);
		return {
			activityAt: row.updatedAt ?? undefined,
			locators: instalmentsOf(resolved),
			resolved,
			row,
		};
	} catch {
		return undefined;
	}
};

const latestActivity = (
	group: readonly TrackedContinuity[],
): Date | undefined => {
	let latest: Date | undefined;
	for (const entry of group) {
		const next = entry.activityAt;
		if (next === undefined) {
			continue;
		}
		if (latest === undefined || next.getTime() > latest.getTime()) {
			latest = next;
		}
	}
	return latest;
};

const collapseTracked = (
	bySurvivor: Map<string, TrackedContinuity[]>,
): TrackedContinuity[] => {
	const collapsed: TrackedContinuity[] = [];
	for (const [canonicalId, group] of bySurvivor) {
		const [head] = group;
		if (head === undefined) {
			continue;
		}
		collapsed.push({
			activityAt: latestActivity(group),
			locators: head.locators,
			resolved: head.resolved,
			row: preferStatusRow(canonicalId, group),
		});
	}
	return collapsed.toSorted((left, right) => {
		const leftMs = left.activityAt?.getTime() ?? 0;
		const rightMs = right.activityAt?.getTime() ?? 0;
		if (leftMs !== rightMs) {
			return rightMs - leftMs;
		}
		return right.row.id - left.row.id;
	});
};

const trackedContinuities = async (
	engine: EngineRead,
	rows: readonly WatchStatusRow[],
): Promise<TrackedContinuity[]> => {
	const settled = await Promise.all(
		rows.map(async (row) => resolveTrackedRow(engine, row)),
	);
	const bySurvivor = new Map<string, TrackedContinuity[]>();
	for (const tracked of settled) {
		if (tracked === undefined) {
			continue;
		}
		const group = bySurvivor.get(tracked.resolved.continuityId);
		if (group === undefined) {
			bySurvivor.set(tracked.resolved.continuityId, [tracked]);
		} else {
			group.push(tracked);
		}
	}
	return collapseTracked(bySurvivor);
};

const watchedLocators = async (
	db: Db,
	userId: string,
	tracked: readonly TrackedContinuity[],
): Promise<ReadonlySet<string>> => {
	const locatorSet = new Set(tracked.flatMap((entry) => [...entry.locators]));
	if (locatorSet.size === 0) {
		return new Set();
	}
	const rows = await db
		.select({ locator: episodeProgress.instalmentLocator })
		.from(episodeProgress)
		.where(eq(episodeProgress.userId, userId))
		.all();
	return new Set(
		rows.map((row) => row.locator).filter((locator) => locatorSet.has(locator)),
	);
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
