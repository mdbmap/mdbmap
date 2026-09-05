import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { continuityAliases } from "@/db/engine-schema";
import {
	episodeProgress,
	personalRating,
	user,
	watchStatus,
} from "@/db/schema";
import { freshDb } from "@/db/test-helpers";
import type { ResolveResult } from "@/engine";
import { createEngine } from "@/engine";
import { parseContinuityKey } from "@/engine/continuity/keys";
import {
	seedCrossGroupContinuity,
	seedSpyXFamily,
	seedTmdbContinuity,
} from "@/engine/test-continuity";
import type { ORPCContext } from "@/orpc/context";
import { instalmentsOf } from "@/orpc/instalments";
import { defaultProviders } from "@/orpc/providers";
import type {
	MetadataProvider,
	Providers,
	WorkMetadata,
} from "@/orpc/providers";

import { router } from "./index.ts";

type TestDb = Awaited<ReturnType<typeof freshDb>>;

const metadataFor = (resolved: ResolveResult): WorkMetadata => ({
	backdropRef: undefined,
	cast: [],
	coverRef: `https://img.test/${resolved.continuityId}.jpg`,
	genres: [],
	ifYouLiked: [],
	nativeTitle: undefined,
	productionStatus: undefined,
	runtimeMinutes: undefined,
	segments: [],
	span: "",
	staff: [],
	studios: [],
	synopsis: "",
	title: `Work ${resolved.continuityId}`,
});

const titledProvider: MetadataProvider = {
	fetchWork: async (resolved) => {
		await Promise.resolve();
		return metadataFor(resolved);
	},
};

const brokenProvider: MetadataProvider = {
	fetchWork: async () => {
		await Promise.resolve();
		throw new Error("metadata provider unavailable");
	},
};

const providersUsing = (metadata: MetadataProvider): Providers => ({
	...defaultProviders,
	metadata: { anidb: metadata, tmdb: metadata },
});

const clientFor = (
	db: TestDb,
	userId: string | undefined,
	providers: Providers = providersUsing(titledProvider),
	engine?: ORPCContext["engine"],
) =>
	createRouterClient(router, {
		context: {
			db,
			...(engine === undefined ? {} : { engine }),
			providers,
			resolveSession: () => (userId === undefined ? undefined : { id: userId }),
		} satisfies ORPCContext,
	});

const seededViewer = async () => {
	const db = await freshDb();
	await db
		.insert(user)
		.values({ email: "a@b.test", id: "user-1", name: "Ada" })
		.run();
	return db;
};

const track = async (
	db: TestDb,
	continuityKey: string,
	updatedAt: Date,
	options: {
		rewatchCount?: number;
		status?: "completed" | "dropped" | "watching";
	} = {},
) => {
	await db
		.insert(watchStatus)
		.values({
			continuityKey,
			rewatchCount: options.rewatchCount ?? 0,
			status: options.status ?? "watching",
			updatedAt,
			userId: "user-1",
		})
		.run();
};

const locatorsFor = async (db: TestDb, continuityId: string) =>
	instalmentsOf(await createEngine(db).resolveContinuity(continuityId));

const retireInto = async (
	db: TestDb,
	survivorKey: string,
	retiredKey: string,
) => {
	const survivorId = parseContinuityKey(survivorKey);
	const retiredId = parseContinuityKey(retiredKey);
	if (survivorId === undefined || retiredId === undefined) {
		throw new Error("expected numeric continuity keys");
	}
	await db
		.insert(continuityAliases)
		.values({
			retiredContinuityId: retiredId,
			survivorContinuityId: survivorId,
		})
		.run();
};

describe("library.list", () => {
	it("summarises a tracked continuity with progress and personal rating", async () => {
		const db = await seededViewer();
		const { continuityId } = await seedSpyXFamily(db);
		await track(db, continuityId, new Date("2026-01-01T00:00:00Z"), {
			rewatchCount: 2,
		});
		const locators = await locatorsFor(db, continuityId);
		await db
			.insert(episodeProgress)
			.values(
				locators.slice(0, 3).map((instalmentLocator) => ({
					instalmentLocator,
					userId: "user-1",
					watchedAt: new Date("2026-04-09T12:00:00.000Z"),
				})),
			)
			.run();
		await db
			.insert(personalRating)
			.values({
				score: 9,
				unitKey: continuityId,
				unitKind: "work",
				userId: "user-1",
			})
			.run();

		const entries = await clientFor(db, "user-1").library.list({});

		expect(entries).toEqual([
			{
				continuityId,
				coverRef: `https://img.test/${continuityId}.jpg`,
				finishedAt: undefined,
				mediaKind: "anime",
				nextUp: {
					number: 4,
					partLabel: "Part 1",
					title: "Episode 4",
				},
				personalRating: 9,
				rewatchCount: 2,
				startedAt: "2026-04-09",
				status: "watching",
				title: `Work ${continuityId}`,
				totalInstalments: locators.length,
				watchedInstalments: 3,
			},
		]);
		expect(locators.length).toBeGreaterThan(3);
	});

	it("sets finishedAt when every instalment is watched", async () => {
		const db = await seededViewer();
		const { continuityId } = await seedTmdbContinuity(db, "movie", "603");
		await track(db, continuityId, new Date("2026-01-01T00:00:00Z"), {
			status: "completed",
		});
		const locators = await locatorsFor(db, continuityId);
		const [locator] = locators;
		if (locator === undefined) {
			throw new Error("expected a film locator");
		}
		await db
			.insert(episodeProgress)
			.values({
				instalmentLocator: locator,
				userId: "user-1",
				watchedAt: new Date("2026-04-09T12:00:00.000Z"),
			})
			.run();

		const entries = await clientFor(db, "user-1").library.list({});

		expect(entries).toEqual([
			expect.objectContaining({
				continuityId,
				finishedAt: "2026-04-09",
				mediaKind: "film",
				startedAt: "2026-04-09",
				status: "completed",
				watchedInstalments: 1,
			}),
		]);
	});

	it("orders tracked works by most recent activity first", async () => {
		const db = await seededViewer();
		const older = await seedSpyXFamily(db);
		const newer = await seedCrossGroupContinuity(db);
		await track(db, older.continuityId, new Date("2026-01-01T00:00:00Z"));
		await track(db, newer.continuityId, new Date("2026-02-01T00:00:00Z"));

		const entries = await clientFor(db, "user-1").library.list({});

		expect(entries.map((entry) => entry.continuityId)).toEqual([
			newer.continuityId,
			older.continuityId,
		]);
	});

	it("returns an empty list when the viewer tracks nothing", async () => {
		const db = await seededViewer();
		await seedSpyXFamily(db);

		expect(await clientFor(db, "user-1").library.list({})).toEqual([]);
	});

	it("keeps the row when its metadata provider fails", async () => {
		const db = await seededViewer();
		const { continuityId } = await seedSpyXFamily(db);
		await track(db, continuityId, new Date("2026-01-01T00:00:00Z"));

		const entries = await clientFor(
			db,
			"user-1",
			providersUsing(brokenProvider),
		).library.list({});

		expect(entries).toHaveLength(1);
		expect(entries[0]?.continuityId).toBe(continuityId);
		expect(entries[0]?.coverRef).toBeUndefined();
		expect(entries[0]?.mediaKind).toBe("anime");
		expect(entries[0]?.runtimeMinutes).toBeUndefined();
		expect(entries[0]?.title).toBeUndefined();
	});

	it("excludes another viewer's tracked works", async () => {
		const db = await seededViewer();
		await db
			.insert(user)
			.values({ email: "b@b.test", id: "user-2", name: "Bea" })
			.run();
		const { continuityId } = await seedSpyXFamily(db);
		await track(db, continuityId, new Date("2026-01-01T00:00:00Z"));

		expect(await clientFor(db, "user-2").library.list({})).toEqual([]);
	});

	it("rejects a viewer without a session", async () => {
		const db = await seededViewer();

		await expect(clientFor(db, undefined).library.list({})).rejects.toThrow(
			/sign in/iu,
		);
	});

	it("collapses merged continuities and prefers the survivor status", async () => {
		const db = await seededViewer();
		const survivor = await seedSpyXFamily(db);
		const retired = await seedCrossGroupContinuity(db);
		await retireInto(db, survivor.continuityId, retired.continuityId);
		await track(db, survivor.continuityId, new Date("2026-01-01T00:00:00Z"), {
			status: "completed",
		});
		await track(db, retired.continuityId, new Date("2026-03-01T00:00:00Z"), {
			status: "watching",
		});

		const entries = await clientFor(db, "user-1").library.list({});

		expect(entries).toHaveLength(1);
		expect(entries[0]?.continuityId).toBe(survivor.continuityId);
		expect(entries[0]?.status).toBe("completed");
	});

	it("returns a personal rating stored under a retired continuity key", async () => {
		const db = await seededViewer();
		const survivor = await seedSpyXFamily(db);
		const retired = await seedCrossGroupContinuity(db);
		await retireInto(db, survivor.continuityId, retired.continuityId);
		await track(db, survivor.continuityId, new Date("2026-01-01T00:00:00Z"));
		await db
			.insert(personalRating)
			.values({
				score: 8,
				unitKey: retired.continuityId,
				unitKind: "work",
				userId: "user-1",
			})
			.run();

		const entries = await clientFor(db, "user-1").library.list({});

		expect(entries).toEqual([
			expect.objectContaining({
				continuityId: survivor.continuityId,
				personalRating: 8,
			}),
		]);
	});

	it("loads progress for libraries whose instalment set exceeds D1 bind limits", async () => {
		const db = await seededViewer();
		const seeded = await Promise.all(
			Array.from({ length: 101 }, async (_slot, index) =>
				seedTmdbContinuity(db, "movie", String(90_000 + index)),
			),
		);
		await Promise.all(
			seeded.map(async ({ continuityId }, index) => {
				await track(
					db,
					continuityId,
					new Date(`2026-01-01T00:00:${String(index % 60).padStart(2, "0")}Z`),
				);
				const [locator] = await locatorsFor(db, continuityId);
				if (locator === undefined) {
					throw new Error("expected a film locator");
				}
				await db
					.insert(episodeProgress)
					.values({ instalmentLocator: locator, userId: "user-1" })
					.run();
			}),
		);

		const entries = await clientFor(db, "user-1").library.list({});

		expect(entries).toHaveLength(101);
		let watchedTotal = 0;
		for (const entry of entries) {
			watchedTotal += entry.watchedInstalments;
		}
		expect(watchedTotal).toBe(101);
	}, 15_000);

	it("skips watch-status rows whose continuity is gone", async () => {
		const db = await seededViewer();
		const { continuityId } = await seedSpyXFamily(db);
		await track(db, continuityId, new Date("2026-01-01T00:00:00Z"));
		await track(db, "continuity:999999", new Date("2026-02-01T00:00:00Z"));

		const entries = await clientFor(db, "user-1").library.list({});

		expect(entries.map((entry) => entry.continuityId)).toEqual([continuityId]);
	});

	it("rejects when continuity resolution fails unexpectedly", async () => {
		const db = await seededViewer();
		const { continuityId } = await seedSpyXFamily(db);
		await track(db, continuityId, new Date("2026-01-01T00:00:00Z"));
		const engine = {
			resolveContinuity: async (requested: string) => {
				await Promise.resolve();
				throw new Error(`engine: boom ${requested}`);
			},
		};

		await expect(
			clientFor(
				db,
				"user-1",
				providersUsing(titledProvider),
				engine,
			).library.list({}),
		).rejects.toThrow(/engine: boom/u);
	});

	it("filters by status", async () => {
		const db = await seededViewer();
		const spy = await seedSpyXFamily(db);
		const tmdb = await seedTmdbContinuity(db, "movie", "550");
		await track(db, spy.continuityId, new Date("2024-01-02T00:00:00.000Z"), {
			status: "watching",
		});
		await track(db, tmdb.continuityId, new Date("2024-01-01T00:00:00.000Z"), {
			status: "completed",
		});
		const client = clientFor(db, "user-1");
		const watching = await client.library.list({ status: "watching" });
		expect(watching).toHaveLength(1);
		expect(watching[0]?.status).toBe("watching");
		const completed = await client.library.list({ status: "completed" });
		expect(completed).toHaveLength(1);
		expect(completed[0]?.status).toBe("completed");
		expect(await client.library.list({ status: "dropped" })).toEqual([]);
	});

	it("sorts by title and personal rating", async () => {
		const db = await seededViewer();
		const spy = await seedSpyXFamily(db);
		const tmdb = await seedTmdbContinuity(db, "movie", "550");
		await track(db, spy.continuityId, new Date("2024-01-02T00:00:00.000Z"));
		await track(db, tmdb.continuityId, new Date("2024-01-03T00:00:00.000Z"));
		await db
			.insert(personalRating)
			.values([
				{
					score: 4,
					unitKey: spy.continuityId,
					unitKind: "work",
					userId: "user-1",
				},
				{
					score: 9,
					unitKey: tmdb.continuityId,
					unitKind: "work",
					userId: "user-1",
				},
			])
			.run();
		const client = clientFor(db, "user-1");
		const byTitle = await client.library.list({ sort: "title" });
		const expectedTitles = [
			`Work ${spy.continuityId}`,
			`Work ${tmdb.continuityId}`,
		].toSorted((left, right) =>
			left.localeCompare(right, undefined, { sensitivity: "base" }),
		);
		expect(byTitle.map((row) => row.title)).toEqual(expectedTitles);
		const byRating = await client.library.list({ sort: "rating" });
		expect(byRating.map((row) => row.personalRating)).toEqual([9, 4]);
	});

	it("includes runtime minutes from work metadata", async () => {
		const db = await seededViewer();
		const { continuityId } = await seedSpyXFamily(db);
		await track(db, continuityId, new Date("2026-01-01T00:00:00Z"));
		const timedProvider: MetadataProvider = {
			fetchWork: async (resolved) => {
				await Promise.resolve();
				return { ...metadataFor(resolved), runtimeMinutes: 24 };
			},
		};

		const entries = await clientFor(
			db,
			"user-1",
			providersUsing(timedProvider),
		).library.list({});

		expect(entries[0]?.mediaKind).toBe("anime");
		expect(entries[0]?.runtimeMinutes).toBe(24);
	});
});
