import { and, desc, eq, inArray } from "drizzle-orm";

import { continuityAliases } from "@/db/engine-schema";
import { personalRating, watchStatus } from "@/db/schema";
import type { EngineRead, ResolveResult } from "@/engine";
import { metadataProviderFor } from "@/engine";
import { continuityKey, parseContinuityKey } from "@/engine/continuity/keys";
import { isMissingContinuity } from "@/engine/continuity/missing";
import { authed } from "@/orpc/base";
import type { Db } from "@/orpc/context";
import { instalmentsOf } from "@/orpc/instalments";
import { nextUp } from "@/orpc/next-up";
import { orderedSegments } from "@/orpc/ordered-segments";
import type { Providers, WorkMetadata } from "@/orpc/providers";
import type { LibraryEntry, LibrarySort } from "@/orpc/schema";
import { LibraryListInput } from "@/orpc/schema";
import { watchSpan } from "@/orpc/watch-span";
import { watchedProgress } from "@/orpc/watched-progress";
import type { WatchedProgress } from "@/orpc/watched-progress";

type WatchStatusRow = typeof watchStatus.$inferSelect;

interface TrackedContinuity {
	readonly activityAt: Date | undefined;
	readonly activityId: number;
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
			activityId: row.id,
			locators: instalmentsOf(resolved),
			resolved,
			row,
		};
	} catch (error) {
		if (isMissingContinuity(error)) {
			return undefined;
		}
		throw error;
	}
};

const latestActivity = (
	group: readonly TrackedContinuity[],
): { activityAt: Date | undefined; activityId: number } => {
	const [first] = group;
	if (first === undefined) {
		throw new Error("expected at least one tracked continuity");
	}
	let best = first;
	for (const entry of group) {
		if (rowActivity(entry.row) > rowActivity(best.row)) {
			best = entry;
		}
	}
	return {
		activityAt: best.row.updatedAt ?? undefined,
		activityId: best.row.id,
	};
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
		const activity = latestActivity(group);
		collapsed.push({
			activityAt: activity.activityAt,
			activityId: activity.activityId,
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
		return right.activityId - left.activityId;
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

const ALIAS_CHUNK = 50;

const retiredKeysBySurvivor = async (
	db: Db,
	survivorIds: readonly number[],
): Promise<ReadonlyMap<number, readonly `continuity:${number}`[]>> => {
	const bySurvivor = new Map<number, `continuity:${number}`[]>();
	if (survivorIds.length === 0) {
		return bySurvivor;
	}
	const chunks: number[][] = [];
	for (let offset = 0; offset < survivorIds.length; offset += ALIAS_CHUNK) {
		chunks.push(survivorIds.slice(offset, offset + ALIAS_CHUNK));
	}
	const pages = await Promise.all(
		chunks.map(async (chunk) =>
			db
				.select({
					retiredContinuityId: continuityAliases.retiredContinuityId,
					survivorContinuityId: continuityAliases.survivorContinuityId,
				})
				.from(continuityAliases)
				.where(inArray(continuityAliases.survivorContinuityId, chunk))
				.all(),
		),
	);
	for (const rows of pages) {
		for (const row of rows) {
			const list = bySurvivor.get(row.survivorContinuityId) ?? [];
			list.push(continuityKey(row.retiredContinuityId));
			bySurvivor.set(row.survivorContinuityId, list);
		}
	}
	return bySurvivor;
};

const ratingFor = (
	ratings: ReadonlyMap<string, number>,
	aliases: ReadonlyMap<number, readonly `continuity:${number}`[]>,
	tracked: TrackedContinuity,
): number | undefined => {
	const canonicalId = tracked.resolved.continuityId;
	const direct =
		ratings.get(canonicalId) ?? ratings.get(tracked.row.continuityKey);
	if (direct !== undefined) {
		return direct;
	}
	const parsed = parseContinuityKey(canonicalId);
	if (parsed === undefined) {
		return undefined;
	}
	for (const key of aliases.get(parsed) ?? []) {
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
	aliases: ReadonlyMap<number, readonly `continuity:${number}`[]>,
	progress: WatchedProgress,
	tracked: TrackedContinuity,
): Promise<LibraryEntry> => {
	const metadata = await workMetadata(providers, tracked.resolved);
	const span = watchSpan(tracked.locators, progress.watchedAt);
	const upcoming = nextUp(
		tracked.row.status,
		await orderedSegments(db, tracked.resolved, metadata),
		progress.locators,
	);
	return {
		continuityId: tracked.resolved.continuityId,
		coverRef: metadata?.coverRef,
		finishedAt: span.finishedAt,
		...(upcoming === undefined ? {} : { nextUp: upcoming }),
		personalRating: ratingFor(ratings, aliases, tracked),
		rewatchCount: tracked.row.rewatchCount,
		startedAt: span.startedAt,
		status: tracked.row.status,
		title: metadata?.title,
		totalInstalments: tracked.locators.length,
		watchedInstalments: tracked.locators.filter((locator) =>
			progress.locators.has(locator),
		).length,
	};
};

const untitledTitle = "";

const compareTitle = (left: LibraryEntry, right: LibraryEntry): number => {
	const leftTitle = left.title ?? untitledTitle;
	const rightTitle = right.title ?? untitledTitle;
	if (leftTitle === untitledTitle && rightTitle !== untitledTitle) {
		return 1;
	}
	if (rightTitle === untitledTitle && leftTitle !== untitledTitle) {
		return -1;
	}
	const byTitle = leftTitle.localeCompare(rightTitle, undefined, {
		sensitivity: "base",
	});
	if (byTitle !== 0) {
		return byTitle;
	}
	return left.continuityId.localeCompare(right.continuityId);
};

const compareRating = (left: LibraryEntry, right: LibraryEntry): number => {
	const leftRating = left.personalRating;
	const rightRating = right.personalRating;
	if (leftRating === undefined && rightRating === undefined) {
		return left.continuityId.localeCompare(right.continuityId);
	}
	if (leftRating === undefined) {
		return 1;
	}
	if (rightRating === undefined) {
		return -1;
	}
	if (leftRating !== rightRating) {
		return rightRating - leftRating;
	}
	return left.continuityId.localeCompare(right.continuityId);
};

const sortEntries = (
	entries: LibraryEntry[],
	sort: LibrarySort | undefined,
): LibraryEntry[] => {
	switch (sort) {
		case undefined:
		case "activity": {
			return entries;
		}
		case "title": {
			return entries.toSorted(compareTitle);
		}
		case "rating": {
			return entries.toSorted(compareRating);
		}
	}
};

const list = authed
	.input(LibraryListInput)
	.handler(async ({ context, input }): Promise<LibraryEntry[]> => {
		const userId = context.user.id;
		const rows = await context.db
			.select()
			.from(watchStatus)
			.where(eq(watchStatus.userId, userId))
			.orderBy(desc(watchStatus.updatedAt), desc(watchStatus.id))
			.all();
		const tracked = await trackedContinuities(context.engine, rows);
		const scoped =
			input.status === undefined
				? tracked
				: tracked.filter((entry) => entry.row.status === input.status);
		const survivorIds = [
			...new Set(
				scoped
					.map((entry) => parseContinuityKey(entry.resolved.continuityId))
					.filter((id): id is number => id !== undefined),
			),
		];
		const [progress, ratings] = await Promise.all([
			watchedProgress(context.db, userId, scoped),
			workRatings(context.db, userId),
		]);
		const aliases =
			ratings.size === 0
				? new Map<number, readonly `continuity:${number}`[]>()
				: await retiredKeysBySurvivor(context.db, survivorIds);
		const entries = await Promise.all(
			scoped.map(async (entry) =>
				toEntry(
					context.db,
					context.providers,
					ratings,
					aliases,
					progress,
					entry,
				),
			),
		);
		return sortEntries(entries, input.sort);
	});

const library = { list };

export { library };
