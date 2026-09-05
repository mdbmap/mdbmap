import { describe, expect, it } from "vitest";

import {
	DAY_MS,
	HOUR_MS,
	freshnessClassOf,
	planRefresh,
	userRefreshRetryAt,
} from "./metadata-freshness.ts";

const now = new Date("2026-09-05T12:00:00.000Z");

describe("freshnessClassOf", () => {
	it("classifies returning and in-production titles as continuing", () => {
		expect(
			freshnessClassOf(
				{
					airedFrom: "2020-01-01",
					airedTo: "2020-02-01",
					productionStatus: "Returning Series",
				},
				now,
			),
		).toBe("continuing");
		expect(
			freshnessClassOf(
				{
					airedFrom: undefined,
					airedTo: undefined,
					productionStatus: "In Production",
				},
				now,
			),
		).toBe("continuing");
	});

	it("classifies planned titles as upcoming", () => {
		expect(
			freshnessClassOf(
				{
					airedFrom: "2027-01-01",
					airedTo: undefined,
					productionStatus: "Planned",
				},
				now,
			),
		).toBe("upcoming");
	});

	it("classifies ended and released titles as completed", () => {
		expect(
			freshnessClassOf(
				{
					airedFrom: "2020-01-01",
					airedTo: "2020-06-01",
					productionStatus: "Ended",
				},
				now,
			),
		).toBe("completed");
		expect(
			freshnessClassOf(
				{
					airedFrom: "2001-05-16",
					airedTo: "2001-05-16",
					productionStatus: "Released",
				},
				now,
			),
		).toBe("completed");
	});

	it("uses air dates when status is missing", () => {
		expect(
			freshnessClassOf(
				{
					airedFrom: "2027-01-01",
					airedTo: undefined,
					productionStatus: undefined,
				},
				now,
			),
		).toBe("upcoming");
		expect(
			freshnessClassOf(
				{
					airedFrom: "2026-01-01",
					airedTo: undefined,
					productionStatus: undefined,
				},
				now,
			),
		).toBe("continuing");
		expect(
			freshnessClassOf(
				{
					airedFrom: "2020-01-01",
					airedTo: "2020-06-01",
					productionStatus: undefined,
				},
				now,
			),
		).toBe("completed");
	});
});

describe("planRefresh", () => {
	it("fetches both buckets on a miss or force", () => {
		expect(
			planRefresh({
				freshnessClass: "completed",
				now,
				stored: undefined,
			}),
		).toEqual({ fetchCore: true, fetchVolatile: true, serveStale: false });
		expect(
			planRefresh({
				force: true,
				freshnessClass: "completed",
				now,
				refreshIfDue: true,
				stored: {
					coreFetchedAt: now,
					volatileFetchedAt: now,
				},
			}),
		).toEqual({ fetchCore: true, fetchVolatile: true, serveStale: false });
	});

	it("does not recrawl a stored document unless refreshIfDue is set", () => {
		const later = new Date(now.getTime() + 2 * DAY_MS);
		expect(
			planRefresh({
				freshnessClass: "continuing",
				now: later,
				stored: { coreFetchedAt: now, volatileFetchedAt: now },
			}),
		).toEqual({ fetchCore: false, fetchVolatile: false, serveStale: true });
	});

	it("refetches continuing volatile after six hours and serves it inline", () => {
		const later = new Date(now.getTime() + 6 * HOUR_MS);
		expect(
			planRefresh({
				freshnessClass: "continuing",
				now: later,
				refreshIfDue: true,
				stored: { coreFetchedAt: now, volatileFetchedAt: now },
			}),
		).toEqual({ fetchCore: false, fetchVolatile: true, serveStale: false });
	});

	it("serves completed titles stale and refreshes them in the background", () => {
		const later = new Date(now.getTime() + 30 * DAY_MS);
		expect(
			planRefresh({
				freshnessClass: "completed",
				now: later,
				refreshIfDue: true,
				stored: { coreFetchedAt: now, volatileFetchedAt: now },
			}),
		).toEqual({ fetchCore: false, fetchVolatile: true, serveStale: true });
	});
});

describe("userRefreshRetryAt", () => {
	it("admits a refresh when no lease exists", () => {
		expect(userRefreshRetryAt(undefined, now)).toBeUndefined();
	});

	it("blocks a second refresh inside 24 hours", () => {
		const insideWindow = new Date(now.getTime() + HOUR_MS);
		const retryAt = userRefreshRetryAt(now, insideWindow);
		const expectedRetry = new Date(now.getTime() + DAY_MS).toISOString();
		expect(retryAt?.toISOString()).toBe(expectedRetry);
	});

	it("admits a refresh after 24 hours", () => {
		const later = new Date(now.getTime() + DAY_MS);
		expect(userRefreshRetryAt(now, later)).toBeUndefined();
	});
});
