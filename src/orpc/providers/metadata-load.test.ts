import { describe, expect, it, vi } from "vitest";

import {
	coreSnapshotSchema,
	volatileSnapshotSchema,
} from "./metadata-document.ts";
import type { Snapshots } from "./metadata-document.ts";
import { DAY_MS, HOUR_MS } from "./metadata-freshness.ts";
import { resolveCatalogueDocument } from "./metadata-load.ts";
import { createMemoryMetadataStore } from "./metadata-store.ts";

const VERSION = 1;
const now = new Date("2026-09-05T12:00:00.000Z");

const snapshotsOf = (title: string, airedTo: string): Snapshots => ({
	core: coreSnapshotSchema.parse({
		cast: [],
		genres: ["Drama"],
		ifYouLiked: [],
		localized: [{ locale: "en", synopsis: "Plot", title }],
		productionStatus: "Returning Series",
		segments: [{ label: "Season 1", year: 2026 }],
		staff: [],
		studios: [],
		synopsis: "Plot",
		title,
		version: VERSION,
	}),
	volatile: volatileSnapshotSchema.parse({
		segments: [
			{
				airedFrom: "2026-01-01",
				airedTo,
				episodes: [{ number: 1, title: "Pilot" }],
			},
		],
		span: "2026",
		version: VERSION,
	}),
});

describe("resolveCatalogueDocument", () => {
	it("keeps the core fetch timestamp when only volatile is due", async () => {
		const store = createMemoryMetadataStore();
		const first = snapshotsOf("Show", "2026-02-01");
		await resolveCatalogueDocument({
			entryKey: "tv:1",
			fetchSnapshots: () => first,
			now,
			options: { now, refreshIfDue: true },
			provider: "tmdb",
			store,
			version: VERSION,
		});
		let fetchCore = 0;
		let fetchVolatile = 0;
		const later = new Date(now.getTime() + 6 * HOUR_MS);
		const loaded = await resolveCatalogueDocument({
			entryKey: "tv:1",
			fetchSnapshots: (need, previous) => {
				fetchCore += need.fetchCore ? 1 : 0;
				fetchVolatile += need.fetchVolatile ? 1 : 0;
				return {
					core: previous?.core ?? first.core,
					volatile: snapshotsOf("Show", "2026-03-01").volatile,
				};
			},
			now: later,
			options: { now: later, refreshIfDue: true },
			provider: "tmdb",
			store,
			version: VERSION,
		});
		expect(fetchCore).toBe(0);
		expect(fetchVolatile).toBe(1);
		expect(loaded.coreFetchedAt.toISOString()).toBe(now.toISOString());
		expect(loaded.volatileFetchedAt.toISOString()).toBe(later.toISOString());
		expect(loaded.snapshots.volatile.segments[0]?.airedTo).toBe("2026-03-01");
	});

	it("serves a completed document stale and refreshes in the background", async () => {
		const store = createMemoryMetadataStore();
		const completed: Snapshots = {
			core: {
				...snapshotsOf("Movie", "2001-05-16").core,
				productionStatus: "Released",
			},
			volatile: snapshotsOf("Movie", "2001-05-16").volatile,
		};
		await resolveCatalogueDocument({
			entryKey: "movie:1",
			fetchSnapshots: () => completed,
			now,
			options: { now, refreshIfDue: true },
			provider: "tmdb",
			store,
			version: VERSION,
		});
		const fetchSnapshots = vi.fn(() => completed);
		const scheduled: Promise<void>[] = [];
		const later = new Date(now.getTime() + 30 * DAY_MS);
		const served = await resolveCatalogueDocument({
			entryKey: "movie:1",
			fetchSnapshots,
			now: later,
			options: {
				now: later,
				refreshIfDue: true,
				schedule: (task) => {
					scheduled.push(task);
				},
			},
			provider: "tmdb",
			store,
			version: VERSION,
		});
		expect(served.coreFetchedAt.toISOString()).toBe(now.toISOString());
		expect(served.volatileFetchedAt.toISOString()).toBe(now.toISOString());
		const [task] = scheduled;
		if (task === undefined) {
			throw new Error("expected a background refresh");
		}
		await task;
		expect(fetchSnapshots).toHaveBeenCalledTimes(1);
		const stored = await store.get("tmdb", "movie:1");
		expect(stored?.volatileFetchedAt.toISOString()).toBe(later.toISOString());
		expect(stored?.coreFetchedAt.toISOString()).toBe(now.toISOString());
	});
});
