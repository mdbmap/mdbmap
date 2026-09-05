import { and, eq, inArray } from "drizzle-orm";

import { episodeProgress, watchStatus } from "@/db/schema";
import type { EngineRead, MediaKind, ResolveResult } from "@/engine";
import { metadataProviderFor } from "@/engine";
import { isMissingContinuity } from "@/engine/continuity/missing";
import { authed } from "@/orpc/base";
import type { Db } from "@/orpc/context";
import { instalmentsOf } from "@/orpc/instalments";
import { FILM_LABEL } from "@/orpc/next-up";
import type { NextUpSegment } from "@/orpc/next-up";
import { orderedSegments } from "@/orpc/ordered-segments";
import type { Providers, WorkMetadata } from "@/orpc/providers";
import type {
	HistoryEntry,
	HistoryListCursor,
	HistoryListResult,
} from "@/orpc/schema";
import { HistoryListInput } from "@/orpc/schema";

const UNTITLED = "Title unavailable";
const DEFAULT_LIMIT = 50;
const LOCATOR_CHUNK = 50;
const META_BATCH = 8;

type WatchStatusRow = typeof watchStatus.$inferSelect;

interface TrackedWork {
	readonly locators: readonly string[];
	readonly resolved: ResolveResult;
}

interface HistoryListCursorPayload {
	progressId: number;
	watchedAt: string;
}

interface ProgressRow {
	readonly id: number;
	readonly locator: string;
	readonly watchedAt: Date;
}

interface InstalmentRef {
	readonly instalmentTitle: string;
	readonly number: number;
	readonly partLabel: string;
}

interface WorkPresentation {
	readonly coverRef: string | undefined;
	readonly mediaKind: MediaKind;
	readonly segments: readonly NextUpSegment[];
	readonly workTitle: string;
}

const encodeCursor = (payload: HistoryListCursorPayload): HistoryListCursor =>
	`${String(payload.progressId)}:${payload.watchedAt}`;

const decodeCursor = (
	cursor: HistoryListCursor,
): HistoryListCursorPayload | undefined => {
	const separator = cursor.indexOf(":");
	if (separator < 1) {
		return undefined;
	}
	const progressId = Number(cursor.slice(0, separator));
	const watchedAt = cursor.slice(separator + 1);
	if (!Number.isSafeInteger(progressId) || progressId < 1) {
		return undefined;
	}
	if (Number.isNaN(Date.parse(watchedAt))) {
		return undefined;
	}
	return { progressId, watchedAt };
};

const resolveTracked = async (
	engine: EngineRead,
	row: WatchStatusRow,
): Promise<TrackedWork | undefined> => {
	try {
		const resolved = await engine.resolveContinuity(row.continuityKey);
		return { locators: instalmentsOf(resolved), resolved };
	} catch (error) {
		if (isMissingContinuity(error)) {
			return undefined;
		}
		throw error;
	}
};

const collapseTracked = async (
	engine: EngineRead,
	rows: readonly WatchStatusRow[],
): Promise<TrackedWork[]> => {
	const settled = await Promise.all(
		rows.map(async (row) => resolveTracked(engine, row)),
	);
	const bySurvivor = new Map<string, TrackedWork>();
	for (const tracked of settled) {
		if (tracked === undefined) {
			continue;
		}
		if (!bySurvivor.has(tracked.resolved.continuityId)) {
			bySurvivor.set(tracked.resolved.continuityId, tracked);
		}
	}
	return [...bySurvivor.values()];
};

const locatorChunks = (locators: readonly string[]): string[][] => {
	const chunks: string[][] = [];
	for (let offset = 0; offset < locators.length; offset += LOCATOR_CHUNK) {
		chunks.push(locators.slice(offset, offset + LOCATOR_CHUNK));
	}
	return chunks;
};

const mapInBatches = async <Item, Result>(
	items: readonly Item[],
	batchSize: number,
	mapper: (item: Item) => Promise<Result>,
): Promise<Result[]> => {
	if (items.length === 0) {
		return [];
	}
	const head = await Promise.all(
		items.slice(0, batchSize).map(async (item) => mapper(item)),
	);
	const rest = items.slice(batchSize);
	if (rest.length === 0) {
		return head;
	}
	return [...head, ...(await mapInBatches(rest, batchSize, mapper))];
};

const locatorOwner = (
	tracked: readonly TrackedWork[],
): ReadonlyMap<string, TrackedWork> => {
	const owners = new Map<string, TrackedWork>();
	for (const work of tracked) {
		for (const locator of work.locators) {
			if (!owners.has(locator)) {
				owners.set(locator, work);
			}
		}
	}
	return owners;
};

const progressFor = async (
	db: Db,
	userId: string,
	locators: readonly string[],
): Promise<ProgressRow[]> => {
	if (locators.length === 0) {
		return [];
	}
	const pages = await Promise.all(
		locatorChunks(locators).map(async (chunk) =>
			db
				.select({
					id: episodeProgress.id,
					locator: episodeProgress.instalmentLocator,
					watchedAt: episodeProgress.watchedAt,
				})
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
	return pages.flat();
};

const compareProgress = (left: ProgressRow, right: ProgressRow): number => {
	const byTime = right.watchedAt.getTime() - left.watchedAt.getTime();
	if (byTime !== 0) {
		return byTime;
	}
	return right.id - left.id;
};

const isOlderThanCursor = (
	row: ProgressRow,
	cursor: HistoryListCursorPayload,
): boolean => {
	const rowMs = row.watchedAt.getTime();
	const cursorMs = Date.parse(cursor.watchedAt);
	if (rowMs !== cursorMs) {
		return rowMs < cursorMs;
	}
	return row.id < cursor.progressId;
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

const instalmentRef = (
	segments: readonly NextUpSegment[],
	locator: string,
): InstalmentRef | undefined => {
	for (const [segmentIndex, segment] of segments.entries()) {
		const position = segment.instalments.indexOf(locator);
		if (position === -1) {
			continue;
		}
		if (segment.kind === "atomic") {
			return {
				instalmentTitle: segment.label ?? FILM_LABEL,
				number: 1,
				partLabel: FILM_LABEL,
			};
		}
		const episode = segment.episodes?.[position];
		const number = episode?.number ?? position + 1;
		return {
			instalmentTitle: episode?.title ?? `Episode ${number}`,
			number,
			partLabel: segment.label ?? `Part ${segmentIndex + 1}`,
		};
	}
	return undefined;
};

const uniqueWorks = (
	page: readonly ProgressRow[],
	owners: ReadonlyMap<string, TrackedWork>,
): TrackedWork[] => {
	const works: TrackedWork[] = [];
	const seen = new Set<string>();
	for (const row of page) {
		const work = owners.get(row.locator);
		if (work === undefined) {
			continue;
		}
		if (seen.has(work.resolved.continuityId)) {
			continue;
		}
		seen.add(work.resolved.continuityId);
		works.push(work);
	}
	return works;
};

const presentationsFor = async (
	db: Db,
	providers: Providers,
	works: readonly TrackedWork[],
): Promise<ReadonlyMap<string, WorkPresentation>> => {
	const fetched = await mapInBatches(works, META_BATCH, async (work) => {
		const metadata = await workMetadata(providers, work.resolved);
		const segments = await orderedSegments(db, work.resolved, metadata);
		const workTitle =
			metadata === undefined || metadata.title === ""
				? UNTITLED
				: metadata.title;
		return [
			work.resolved.continuityId,
			{
				coverRef: metadata?.coverRef,
				mediaKind: work.resolved.mediaKind,
				segments,
				workTitle,
			} satisfies WorkPresentation,
		] as const;
	});
	return new Map(fetched);
};

const toEntries = (
	page: readonly ProgressRow[],
	owners: ReadonlyMap<string, TrackedWork>,
	presentations: ReadonlyMap<string, WorkPresentation>,
): HistoryEntry[] => {
	const entries: HistoryEntry[] = [];
	for (const row of page) {
		const work = owners.get(row.locator);
		if (work === undefined) {
			continue;
		}
		const presentation = presentations.get(work.resolved.continuityId);
		if (presentation === undefined) {
			continue;
		}
		const ref = instalmentRef(presentation.segments, row.locator);
		if (ref === undefined) {
			continue;
		}
		entries.push({
			continuityId: work.resolved.continuityId,
			coverRef: presentation.coverRef,
			instalmentTitle: ref.instalmentTitle,
			mediaKind: presentation.mediaKind,
			number: ref.number,
			partLabel: ref.partLabel,
			watchedAt: row.watchedAt.toISOString(),
			workTitle: presentation.workTitle,
		});
	}
	return entries;
};

const emptyResult = (): HistoryListResult => ({ entries: [] });

const list = authed
	.input(HistoryListInput)
	.handler(async ({ context, input }): Promise<HistoryListResult> => {
		const cursor =
			input.cursor === undefined ? undefined : decodeCursor(input.cursor);
		const limit = input.limit ?? DEFAULT_LIMIT;
		const userId = context.user.id;
		const rows = await context.db
			.select()
			.from(watchStatus)
			.where(eq(watchStatus.userId, userId))
			.all();
		const tracked = await collapseTracked(context.engine, rows);
		const owners = locatorOwner(tracked);
		const progress = await progressFor(context.db, userId, [...owners.keys()]);
		const ranked = progress.toSorted(compareProgress);
		const afterCursor =
			cursor === undefined
				? ranked
				: ranked.filter((row) => isOlderThanCursor(row, cursor));
		const page = afterCursor.slice(0, limit);
		if (page.length === 0) {
			return emptyResult();
		}
		const presentations = await presentationsFor(
			context.db,
			context.providers,
			uniqueWorks(page, owners),
		);
		const entries = toEntries(page, owners, presentations);
		const last = page.at(-1);
		if (afterCursor.length > limit && last !== undefined) {
			return {
				entries,
				nextCursor: encodeCursor({
					progressId: last.id,
					watchedAt: last.watchedAt.toISOString(),
				}),
			};
		}
		return { entries };
	});

const history = { list };

export { history };
