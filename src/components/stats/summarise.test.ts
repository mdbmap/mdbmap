import { describe, expect, it } from "vitest";

import type { LibraryEntry } from "@/orpc/schema";

import { formatWatchedHours, summarise } from "./summarise";

const entry = (overrides: Partial<LibraryEntry> = {}): LibraryEntry => ({
	continuityId: "continuity:1",
	coverRef: undefined,
	finishedAt: undefined,
	mediaKind: "anime",
	personalRating: undefined,
	rewatchCount: 0,
	startedAt: undefined,
	status: "watching",
	title: "Spy × Family",
	totalInstalments: 12,
	watchedInstalments: 4,
	...overrides,
});

describe("summarise empty library", () => {
	it("returns zeros and no mean", () => {
		expect(summarise([])).toEqual({
			kindCounts: {
				anime: 0,
				film: 0,
				tv: 0,
			},
			meanRating: undefined,
			ratedCount: 0,
			rewatchCount: 0,
			statusCounts: {
				completed: 0,
				dropped: 0,
				on_hold: 0,
				rewatching: 0,
				watching: 0,
			},
			totalInstalments: 0,
			totalWorks: 0,
			watchedInstalments: 0,
			watchedMinutes: 0,
		});
	});
});

describe("summarise watch statuses", () => {
	it("counts each status and keeps unused zeros", () => {
		const stats = summarise([
			entry({ continuityId: "continuity:1", status: "watching" }),
			entry({ continuityId: "continuity:2", status: "watching" }),
			entry({ continuityId: "continuity:3", status: "completed" }),
			entry({ continuityId: "continuity:4", status: "dropped" }),
			entry({ continuityId: "continuity:5", status: "rewatching" }),
		]);

		expect(stats.statusCounts).toEqual({
			completed: 1,
			dropped: 1,
			on_hold: 0,
			rewatching: 1,
			watching: 2,
		});
		expect(stats.totalWorks).toBe(5);
	});
});

describe("summarise personal ratings", () => {
	it("means only rated works, to one decimal", () => {
		const mixed = summarise([
			entry({ continuityId: "continuity:1", personalRating: 8 }),
			entry({ continuityId: "continuity:2", personalRating: undefined }),
			entry({ continuityId: "continuity:3", personalRating: 9 }),
		]);
		expect(mixed.meanRating).toBe(8.5);
		expect(mixed.ratedCount).toBe(2);

		const thirds = summarise([
			entry({ continuityId: "continuity:1", personalRating: 8 }),
			entry({ continuityId: "continuity:2", personalRating: 8 }),
			entry({ continuityId: "continuity:3", personalRating: 9 }),
		]);
		expect(thirds.meanRating).toBe(8.3);
		expect(thirds.ratedCount).toBe(3);
	});

	it("has no mean when every work is unrated", () => {
		const stats = summarise([
			entry({ continuityId: "continuity:1" }),
			entry({ continuityId: "continuity:2", status: "completed" }),
		]);
		expect(stats.meanRating).toBeUndefined();
		expect(stats.ratedCount).toBe(0);
	});
});

describe("summarise instalments and rewatches", () => {
	it("sums instalments and rewatch counts", () => {
		const stats = summarise([
			entry({
				continuityId: "continuity:1",
				rewatchCount: 2,
				totalInstalments: 12,
				watchedInstalments: 4,
			}),
			entry({
				continuityId: "continuity:2",
				rewatchCount: 0,
				totalInstalments: 13,
				watchedInstalments: 13,
			}),
		]);
		expect(stats.totalInstalments).toBe(25);
		expect(stats.watchedInstalments).toBe(17);
		expect(stats.rewatchCount).toBe(2);
	});
});

describe("summarise hours watched", () => {
	it("sums watched instalments times known runtime", () => {
		const stats = summarise([
			entry({
				continuityId: "continuity:1",
				runtimeMinutes: 24,
				watchedInstalments: 25,
			}),
			entry({
				continuityId: "continuity:2",
				runtimeMinutes: 12,
				watchedInstalments: 13,
			}),
			entry({
				continuityId: "continuity:3",
				watchedInstalments: 4,
			}),
		]);
		expect(stats.watchedMinutes).toBe(756);
	});

	it("skips entries whose runtime is missing", () => {
		const stats = summarise([
			entry({ runtimeMinutes: undefined, watchedInstalments: 10 }),
		]);
		expect(stats.watchedMinutes).toBe(0);
	});
});

describe("summarise media kinds", () => {
	it("counts works per kind", () => {
		const stats = summarise([
			entry({ continuityId: "continuity:1", mediaKind: "anime" }),
			entry({ continuityId: "continuity:2", mediaKind: "anime" }),
			entry({ continuityId: "continuity:3", mediaKind: "film" }),
			entry({ continuityId: "continuity:4", mediaKind: "tv" }),
		]);
		expect(stats.kindCounts).toEqual({
			anime: 2,
			film: 1,
			tv: 1,
		});
	});
});

describe("formatWatchedHours", () => {
	it("formats zero, minutes, hours, and mixed", () => {
		expect(formatWatchedHours(0)).toBe("0m");
		expect(formatWatchedHours(45)).toBe("45m");
		expect(formatWatchedHours(120)).toBe("2h");
		expect(formatWatchedHours(756)).toBe("12h 36m");
	});
});
