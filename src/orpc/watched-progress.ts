import { eq } from "drizzle-orm";

import { episodeProgress } from "@/db/schema";
import type { Db } from "@/orpc/context";

interface LocatorsHolder {
	readonly locators: readonly string[];
}

interface WatchedProgress {
	readonly locators: ReadonlySet<string>;
	readonly watchedAt: ReadonlyMap<string, Date>;
}

const watchedProgress = async (
	db: Db,
	userId: string,
	tracked: readonly LocatorsHolder[],
): Promise<WatchedProgress> => {
	const locatorSet = new Set(tracked.flatMap((entry) => [...entry.locators]));
	if (locatorSet.size === 0) {
		return { locators: new Set(), watchedAt: new Map() };
	}
	const rows = await db
		.select({
			locator: episodeProgress.instalmentLocator,
			watchedAt: episodeProgress.watchedAt,
		})
		.from(episodeProgress)
		.where(eq(episodeProgress.userId, userId))
		.all();
	const locators = new Set<string>();
	const watchedAt = new Map<string, Date>();
	for (const row of rows) {
		if (!locatorSet.has(row.locator)) {
			continue;
		}
		locators.add(row.locator);
		watchedAt.set(row.locator, row.watchedAt);
	}
	return { locators, watchedAt };
};

export { watchedProgress };
export type { WatchedProgress };
