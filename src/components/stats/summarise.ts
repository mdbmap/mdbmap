import type { WatchStatus } from "@/db/schema";
import { watchStatuses } from "@/db/schema";
import type { MediaKind } from "@/engine";
import type { LibraryEntry } from "@/orpc/schema";

type StatusCounts = Record<WatchStatus, number>;
type KindCounts = Record<MediaKind, number>;

interface LibraryStats {
	kindCounts: KindCounts;
	meanRating: number | undefined;
	omittedRuntime: boolean;
	ratedCount: number;
	rewatchCount: number;
	statusCounts: StatusCounts;
	totalInstalments: number;
	totalWorks: number;
	watchedInstalments: number;
	watchedMinutes: number;
}

const mediaKinds = [
	"anime",
	"film",
	"tv",
] as const satisfies readonly MediaKind[];

const isStatusCounts = (
	counts: Partial<StatusCounts>,
): counts is StatusCounts =>
	watchStatuses.every((status) => counts[status] !== undefined);

const isKindCounts = (counts: Partial<KindCounts>): counts is KindCounts =>
	mediaKinds.every((kind) => counts[kind] !== undefined);

const emptyStatusCounts = (): StatusCounts => {
	const counts: Partial<StatusCounts> = {};
	for (const status of watchStatuses) {
		counts[status] = 0;
	}
	if (!isStatusCounts(counts)) {
		throw new Error("stats: incomplete status counts");
	}
	return counts;
};

const emptyKindCounts = (): KindCounts => {
	const counts: Partial<KindCounts> = {};
	for (const kind of mediaKinds) {
		counts[kind] = 0;
	}
	if (!isKindCounts(counts)) {
		throw new Error("stats: incomplete kind counts");
	}
	return counts;
};

const roundMean = (total: number, count: number): number =>
	Math.round((total / count) * 10) / 10;

const formatWatchedHours = (minutes: number): string => {
	if (minutes <= 0) {
		return "0m";
	}
	const hours = Math.trunc(minutes / 60);
	const remaining = minutes % 60;
	if (hours === 0) {
		return `${remaining}m`;
	}
	if (remaining === 0) {
		return `${hours}h`;
	}
	return `${hours}h ${remaining}m`;
};

const OMITTED_RUNTIME_NOTE = "some titles omitted";

const formatHoursWatchedValue = (minutes: number, omitted: boolean): string => {
	const formatted = formatWatchedHours(minutes);
	if (!omitted) {
		return formatted;
	}
	return `${formatted} · ${OMITTED_RUNTIME_NOTE}`;
};

function summarise(entries: readonly LibraryEntry[]): LibraryStats {
	const kindCounts = emptyKindCounts();
	const statusCounts = emptyStatusCounts();
	let ratingTotal = 0;
	let ratedCount = 0;
	let rewatchCount = 0;
	let totalInstalments = 0;
	let watchedInstalments = 0;
	let watchedMinutes = 0;
	let omittedRuntime = false;

	for (const entry of entries) {
		kindCounts[entry.mediaKind] += 1;
		statusCounts[entry.status] += 1;
		if (entry.personalRating !== undefined) {
			ratingTotal += entry.personalRating;
			ratedCount += 1;
		}
		rewatchCount += entry.rewatchCount;
		totalInstalments += entry.totalInstalments;
		watchedInstalments += entry.watchedInstalments;
		if (entry.runtimeMinutes !== undefined) {
			watchedMinutes += entry.watchedInstalments * entry.runtimeMinutes;
		} else if (entry.watchedInstalments > 0) {
			omittedRuntime = true;
		}
	}

	return {
		kindCounts,
		meanRating:
			ratedCount === 0 ? undefined : roundMean(ratingTotal, ratedCount),
		omittedRuntime,
		ratedCount,
		rewatchCount,
		statusCounts,
		totalInstalments,
		totalWorks: entries.length,
		watchedInstalments,
		watchedMinutes,
	};
}

export { formatHoursWatchedValue, formatWatchedHours, mediaKinds, summarise };
export type { KindCounts, LibraryStats, StatusCounts };
