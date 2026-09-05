import { and, eq, inArray } from "drizzle-orm";

import { episodeProgress, watchStatus } from "@/db/schema";
import type { WatchStatus } from "@/db/schema";
import { metadataProviderFor } from "@/engine";
import type { EngineRead, ResolveResult } from "@/engine";
import { addUtcDays, airingDays, isoDay, WINDOW_DAYS } from "@/orpc/airing";
import type { AiringDay, AiringWork } from "@/orpc/airing";
import { authed } from "@/orpc/base";
import type { Db } from "@/orpc/context";
import { instalmentsOf } from "@/orpc/instalments";
import type { Providers, WorkMetadata } from "@/orpc/providers";

const UNTITLED = "Title unavailable";
const CALENDAR_STATUSES = [
	"watching",
	"rewatching",
	"on_hold",
	"plan_to_watch",
] as const satisfies readonly WatchStatus[];

type WatchStatusRow = typeof watchStatus.$inferSelect;

interface TrackedWork {
	readonly locators: readonly string[];
	readonly resolved: ResolveResult;
}

const isMissingContinuity = (error: unknown): boolean =>
	error instanceof Error && error.message.startsWith("engine: no continuity ");

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

const LOCATOR_CHUNK = 50;
const META_BATCH = 8;

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

const watchedLocators = async (
	db: Db,
	userId: string,
	tracked: readonly TrackedWork[],
): Promise<ReadonlySet<string>> => {
	const locatorSet = new Set(tracked.flatMap((entry) => [...entry.locators]));
	if (locatorSet.size === 0) {
		return new Set();
	}
	const pages = await Promise.all(
		locatorChunks([...locatorSet]).map(async (chunk) =>
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
	return new Set(pages.flat().map((row) => row.locator));
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

const toAiringWork = (
	tracked: TrackedWork,
	metadata: WorkMetadata,
	watched: ReadonlySet<string>,
): AiringWork => ({
	continuityId: tracked.resolved.continuityId,
	segments: tracked.resolved.segments.map((segment, index) => {
		const meta = metadata.segments[index];
		return {
			airedFrom: meta?.airedFrom,
			episodes: meta?.episodes,
			instalments: segment.instalments,
			kind: segment.kind,
			label: meta?.label,
		};
	}),
	title: metadata.title === "" ? UNTITLED : metadata.title,
	watched,
});

const list = authed.handler(async ({ context }): Promise<AiringDay[]> => {
	const userId = context.user.id;
	const rows = await context.db
		.select()
		.from(watchStatus)
		.where(
			and(
				eq(watchStatus.userId, userId),
				inArray(watchStatus.status, CALENDAR_STATUSES),
			),
		)
		.all();
	const tracked = await collapseTracked(context.engine, rows);
	const watched = await watchedLocators(context.db, userId, tracked);
	const fromDay = isoDay(new Date());
	const untilDay = addUtcDays(fromDay, WINDOW_DAYS);
	const works = await mapInBatches(tracked, META_BATCH, async (entry) => {
		const metadata = await workMetadata(context.providers, entry.resolved);
		if (metadata === undefined) {
			return;
		}
		return toAiringWork(entry, metadata, watched);
	});
	return airingDays(
		works.filter((entry): entry is AiringWork => entry !== undefined),
		fromDay,
		untilDay,
	);
});

const calendar = { list };

export { calendar };
