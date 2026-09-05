import { ORPCError } from "@orpc/server";
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
const MAX_CURSOR_LENGTH = 80;
const PROGRESS_ID = /^[1-9]\d*$/u;

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
	if (cursor.length > MAX_CURSOR_LENGTH) {
		return undefined;
	}
	const separator = cursor.indexOf(":");
	if (separator < 1) {
		return undefined;
	}
	const idToken = cursor.slice(0, separator);
	if (!PROGRESS_ID.test(idToken)) {
		return undefined;
	}
	const progressId = Number(idToken);
	const watchedAt = cursor.slice(separator + 1);
	if (!Number.isSafeInteger(progressId)) {
		return undefined;
	}
	if (Number.isNaN(Date.parse(watchedAt))) {
		return undefined;
	}
	return { progressId, watchedAt };
};

const parsedCursor = (
	cursor: HistoryListCursor | undefined,
): HistoryListCursorPayload | undefined => {
	if (cursor === undefined) {
		return undefined;
	}
	const decoded = decodeCursor(cursor);
	if (decoded === undefined) {
		throw new ORPCError("BAD_REQUEST", {
			message: "History cursor is invalid.",
		});
	}
	return decoded;
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

const entryFor = (
	row: ProgressRow,
	owners: ReadonlyMap<string, TrackedWork>,
	presentations: ReadonlyMap<string, WorkPresentation>,
): HistoryEntry | undefined => {
	const work = owners.get(row.locator);
	if (work === undefined) {
		return undefined;
	}
	const presentation = presentations.get(work.resolved.continuityId);
	if (presentation === undefined) {
		return undefined;
	}
	const ref = instalmentRef(presentation.segments, row.locator);
	if (ref === undefined) {
		return undefined;
	}
	return {
		continuityId: work.resolved.continuityId,
		coverRef: presentation.coverRef,
		instalmentTitle: ref.instalmentTitle,
		mediaKind: presentation.mediaKind,
		number: ref.number,
		partLabel: ref.partLabel,
		watchedAt: row.watchedAt.toISOString(),
		workTitle: presentation.workTitle,
	};
};

const cursorOf = (row: ProgressRow): HistoryListCursor =>
	encodeCursor({
		progressId: row.id,
		watchedAt: row.watchedAt.toISOString(),
	});

const nextUnfetchedWorks = (
	fromIndex: number,
	afterCursor: readonly ProgressRow[],
	owners: ReadonlyMap<string, TrackedWork>,
	presentations: ReadonlyMap<string, WorkPresentation>,
	batchSize: number,
): TrackedWork[] => {
	const works: TrackedWork[] = [];
	const seen = new Set<string>();
	for (
		let index = fromIndex;
		index < afterCursor.length && works.length < batchSize;
		index += 1
	) {
		const row = afterCursor[index];
		if (row === undefined) {
			continue;
		}
		const work = owners.get(row.locator);
		if (work === undefined) {
			continue;
		}
		const { continuityId } = work.resolved;
		if (presentations.has(continuityId) || seen.has(continuityId)) {
			continue;
		}
		seen.add(continuityId);
		works.push(work);
	}
	return works;
};

interface PageFill {
	readonly afterCursor: readonly ProgressRow[];
	readonly db: Db;
	readonly entries: HistoryEntry[];
	readonly index: number;
	readonly lastEmitted: ProgressRow | undefined;
	readonly limit: number;
	readonly owners: ReadonlyMap<string, TrackedWork>;
	readonly presentations: Map<string, WorkPresentation>;
	readonly providers: Providers;
}

const pageResult = (fill: PageFill): HistoryListResult => {
	const { entries, lastEmitted } = fill;
	if (lastEmitted === undefined || fill.index >= fill.afterCursor.length) {
		return { entries };
	}
	return { entries, nextCursor: cursorOf(lastEmitted) };
};

const rememberPresentations = (
	presentations: Map<string, WorkPresentation>,
	fetched: ReadonlyMap<string, WorkPresentation>,
): void => {
	for (const [continuityId, presentation] of fetched) {
		presentations.set(continuityId, presentation);
	}
};

const fetchMissingPresentations = async (fill: PageFill): Promise<void> => {
	const remaining = fill.limit - fill.entries.length;
	const batchSize = Math.min(META_BATCH, Math.max(remaining, 1));
	const works = nextUnfetchedWorks(
		fill.index,
		fill.afterCursor,
		fill.owners,
		fill.presentations,
		batchSize,
	);
	const fetched = await presentationsFor(fill.db, fill.providers, works);
	rememberPresentations(fill.presentations, fetched);
};

const needsPresentation = (
	work: TrackedWork | undefined,
	presentations: ReadonlyMap<string, WorkPresentation>,
): work is TrackedWork =>
	work !== undefined && !presentations.has(work.resolved.continuityId);

const emitRow = (fill: PageFill, row: ProgressRow): PageFill => {
	const entry = entryFor(row, fill.owners, fill.presentations);
	if (entry === undefined) {
		return { ...fill, index: fill.index + 1 };
	}
	return {
		...fill,
		entries: [...fill.entries, entry],
		index: fill.index + 1,
		lastEmitted: row,
	};
};

const emitReadyRows = (fill: PageFill): PageFill => {
	let current = fill;
	while (
		current.index < current.afterCursor.length &&
		current.entries.length < current.limit
	) {
		const row = current.afterCursor[current.index];
		if (row === undefined) {
			return { ...current, index: current.afterCursor.length };
		}
		if (
			needsPresentation(current.owners.get(row.locator), current.presentations)
		) {
			return current;
		}
		current = emitRow(current, row);
	}
	return current;
};

const fillPage = async (fill: PageFill): Promise<HistoryListResult> => {
	const current = emitReadyRows(fill);
	if (
		current.index >= current.afterCursor.length ||
		current.entries.length >= current.limit
	) {
		return pageResult(current);
	}
	const row = current.afterCursor[current.index];
	if (row === undefined) {
		return pageResult({ ...current, index: current.afterCursor.length });
	}
	await fetchMissingPresentations(current);
	if (
		needsPresentation(current.owners.get(row.locator), current.presentations)
	) {
		return fillPage({ ...current, index: current.index + 1 });
	}
	return fillPage(current);
};

const paginate = async (
	db: Db,
	providers: Providers,
	owners: ReadonlyMap<string, TrackedWork>,
	afterCursor: readonly ProgressRow[],
	limit: number,
): Promise<HistoryListResult> =>
	fillPage({
		afterCursor,
		db,
		entries: [],
		index: 0,
		lastEmitted: undefined,
		limit,
		owners,
		presentations: new Map(),
		providers,
	});

const list = authed
	.input(HistoryListInput)
	.handler(async ({ context, input }): Promise<HistoryListResult> => {
		const cursor = parsedCursor(input.cursor);
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
		return paginate(context.db, context.providers, owners, afterCursor, limit);
	});

const history = { list };

export { history };
