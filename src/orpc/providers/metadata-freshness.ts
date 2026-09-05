import type { FreshnessClass } from "@/db/schema";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const USER_REFRESH_COOLDOWN_MS = DAY_MS;

const INTERVALS = {
	completed: { coreMs: 90 * DAY_MS, volatileMs: 30 * DAY_MS },
	continuing: { coreMs: 7 * DAY_MS, volatileMs: 6 * HOUR_MS },
	upcoming: { coreMs: 7 * DAY_MS, volatileMs: DAY_MS },
} as const;

const CONTINUING_STATUSES = new Set([
	"airing",
	"in production",
	"post production",
	"returning series",
]);
const UPCOMING_STATUSES = new Set(["planned", "rumored", "upcoming"]);
const COMPLETED_STATUSES = new Set([
	"canceled",
	"cancelled",
	"ended",
	"finished",
	"released",
]);

interface FreshnessSignals {
	airedFrom: string | undefined;
	airedTo: string | undefined;
	productionStatus: string | undefined;
}

interface StoredFetchTimes {
	coreFetchedAt: Date;
	volatileFetchedAt: Date;
}

interface RefreshPlan {
	fetchCore: boolean;
	fetchVolatile: boolean;
	serveStale: boolean;
}

interface SnapshotNeed {
	fetchCore: boolean;
	fetchVolatile: boolean;
}

interface MetadataFetchOptions {
	force?: boolean;
	locale?: string;
	now?: Date;
	refreshIfDue?: boolean;
	schedule?: (task: Promise<void>) => void;
}

const parseDateMs = (value: string | undefined): number | undefined => {
	if (value === undefined || value === "") {
		return undefined;
	}
	const ms = Date.parse(value);
	return Number.isNaN(ms) ? undefined : ms;
};

const freshnessClassOf = (
	signals: FreshnessSignals,
	now: Date,
): FreshnessClass => {
	const status = signals.productionStatus?.trim().toLowerCase() ?? "";
	if (CONTINUING_STATUSES.has(status)) {
		return "continuing";
	}
	if (UPCOMING_STATUSES.has(status)) {
		return "upcoming";
	}
	if (COMPLETED_STATUSES.has(status)) {
		return "completed";
	}
	const startMs = parseDateMs(signals.airedFrom);
	if (startMs !== undefined && startMs > now.getTime()) {
		return "upcoming";
	}
	const endMs = parseDateMs(signals.airedTo);
	if (endMs === undefined) {
		return "continuing";
	}
	return endMs > now.getTime() ? "continuing" : "completed";
};

const planRefresh = ({
	freshnessClass,
	force = false,
	now,
	refreshIfDue = false,
	stored,
}: {
	freshnessClass: FreshnessClass;
	force?: boolean;
	now: Date;
	refreshIfDue?: boolean;
	stored: StoredFetchTimes | undefined;
}): RefreshPlan => {
	if (stored === undefined || force) {
		return { fetchCore: true, fetchVolatile: true, serveStale: false };
	}
	if (!refreshIfDue) {
		return { fetchCore: false, fetchVolatile: false, serveStale: true };
	}
	const interval = INTERVALS[freshnessClass];
	const fetchCore =
		now.getTime() - stored.coreFetchedAt.getTime() >= interval.coreMs;
	const fetchVolatile =
		now.getTime() - stored.volatileFetchedAt.getTime() >= interval.volatileMs;
	if (!fetchCore && !fetchVolatile) {
		return { fetchCore: false, fetchVolatile: false, serveStale: true };
	}
	return {
		fetchCore,
		fetchVolatile,
		serveStale: freshnessClass !== "continuing",
	};
};

const laterDate = (left: Date | undefined, right: Date): Date =>
	left === undefined || right.getTime() > left.getTime() ? right : left;

const userRefreshRetryAt = (
	requestedAt: Date | undefined,
	now: Date,
): Date | undefined => {
	if (requestedAt === undefined) {
		return undefined;
	}
	const retryAt = new Date(requestedAt.getTime() + USER_REFRESH_COOLDOWN_MS);
	return retryAt.getTime() > now.getTime() ? retryAt : undefined;
};

export {
	DAY_MS,
	HOUR_MS,
	INTERVALS,
	USER_REFRESH_COOLDOWN_MS,
	freshnessClassOf,
	laterDate,
	planRefresh,
	userRefreshRetryAt,
};
export type {
	MetadataFetchOptions,
	RefreshPlan,
	SnapshotNeed,
	StoredFetchTimes,
};
