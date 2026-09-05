import type { WatchStatus } from "@/db/schema";
import { watchStatuses } from "@/db/schema";
import type { LibraryEntry } from "@/orpc/schema";

type StatusCounts = Record<WatchStatus, number>;

interface LibraryStats {
	meanRating: number | undefined;
	ratedCount: number;
	rewatchCount: number;
	statusCounts: StatusCounts;
	totalInstalments: number;
	totalWorks: number;
	watchedInstalments: number;
}

const isStatusCounts = (
	counts: Partial<Record<WatchStatus, number>>,
): counts is StatusCounts =>
	watchStatuses.every((status) => counts[status] !== undefined);

const emptyCounts = (): StatusCounts => {
	const counts: Partial<Record<WatchStatus, number>> = {};
	for (const status of watchStatuses) {
		counts[status] = 0;
	}
	if (!isStatusCounts(counts)) {
		throw new Error("stats: incomplete status counts");
	}
	return counts;
};

const roundMean = (total: number, count: number): number =>
	Math.round((total / count) * 10) / 10;

function summarise(entries: readonly LibraryEntry[]): LibraryStats {
	const statusCounts = emptyCounts();
	let ratingTotal = 0;
	let ratedCount = 0;
	let rewatchCount = 0;
	let totalInstalments = 0;
	let watchedInstalments = 0;

	for (const entry of entries) {
		statusCounts[entry.status] += 1;
		if (entry.personalRating !== undefined) {
			ratingTotal += entry.personalRating;
			ratedCount += 1;
		}
		rewatchCount += entry.rewatchCount;
		totalInstalments += entry.totalInstalments;
		watchedInstalments += entry.watchedInstalments;
	}

	return {
		meanRating:
			ratedCount === 0 ? undefined : roundMean(ratingTotal, ratedCount),
		ratedCount,
		rewatchCount,
		statusCounts,
		totalInstalments,
		totalWorks: entries.length,
		watchedInstalments,
	};
}

export { summarise };
export type { LibraryStats, StatusCounts };
