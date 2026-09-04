import { and, eq, inArray } from "drizzle-orm";

import { episodeProgress } from "@/db/schema";
import type { Db } from "@/orpc/context";

interface LocatorsHolder {
	readonly locators: readonly string[];
}

interface WatchedProgress {
	readonly locators: ReadonlySet<string>;
	readonly watchedAt: ReadonlyMap<string, Date>;
}

const LOCATOR_CHUNK = 50;

const locatorChunks = (locators: readonly string[]): string[][] => {
	const chunks: string[][] = [];
	for (let offset = 0; offset < locators.length; offset += LOCATOR_CHUNK) {
		chunks.push(locators.slice(offset, offset + LOCATOR_CHUNK));
	}
	return chunks;
};

const watchedProgress = async (
	db: Db,
	userId: string,
	tracked: readonly LocatorsHolder[],
): Promise<WatchedProgress> => {
	const locatorSet = new Set(tracked.flatMap((entry) => [...entry.locators]));
	if (locatorSet.size === 0) {
		return { locators: new Set(), watchedAt: new Map() };
	}
	const pages = await Promise.all(
		locatorChunks([...locatorSet]).map(async (chunk) =>
			db
				.select({
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
	const locators = new Set<string>();
	const watchedAt = new Map<string, Date>();
	for (const row of pages.flat()) {
		locators.add(row.locator);
		watchedAt.set(row.locator, row.watchedAt);
	}
	return { locators, watchedAt };
};

export { watchedProgress };
export type { WatchedProgress };
