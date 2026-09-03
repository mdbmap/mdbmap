import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import {
	episodeProgress,
	personalRating,
	user,
	watchStatus,
} from "@/db/schema";
import { freshDb } from "@/db/test-helpers";
import type { ResolveResult } from "@/engine";
import { createEngine } from "@/engine";
import {
	seedCrossGroupContinuity,
	seedSpyXFamily,
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
	ifYouLiked: [],
	nativeTitle: undefined,
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
) =>
	createRouterClient(router, {
		context: {
			db,
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
	rewatchCount = 0,
) => {
	await db
		.insert(watchStatus)
		.values({
			continuityKey,
			rewatchCount,
			status: "watching",
			updatedAt,
			userId: "user-1",
		})
		.run();
};

const locatorsFor = async (db: TestDb, continuityId: string) =>
	instalmentsOf(await createEngine(db).resolveContinuity(continuityId));

describe("library.list", () => {
	it("summarises a tracked continuity with progress and personal rating", async () => {
		const db = await seededViewer();
		const { continuityId } = await seedSpyXFamily(db);
		await track(db, continuityId, new Date("2026-01-01T00:00:00Z"), 2);
		const locators = await locatorsFor(db, continuityId);
		await db
			.insert(episodeProgress)
			.values(
				locators.slice(0, 3).map((instalmentLocator) => ({
					instalmentLocator,
					userId: "user-1",
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

		const entries = await clientFor(db, "user-1").library.list();

		expect(entries).toEqual([
			{
				continuityId,
				coverRef: `https://img.test/${continuityId}.jpg`,
				personalRating: 9,
				rewatchCount: 2,
				status: "watching",
				title: `Work ${continuityId}`,
				totalInstalments: locators.length,
				watchedInstalments: 3,
			},
		]);
		expect(locators.length).toBeGreaterThan(3);
	});

	it("orders tracked works by most recent activity first", async () => {
		const db = await seededViewer();
		const older = await seedSpyXFamily(db);
		const newer = await seedCrossGroupContinuity(db);
		await track(db, older.continuityId, new Date("2026-01-01T00:00:00Z"));
		await track(db, newer.continuityId, new Date("2026-02-01T00:00:00Z"));

		const entries = await clientFor(db, "user-1").library.list();

		expect(entries.map((entry) => entry.continuityId)).toEqual([
			newer.continuityId,
			older.continuityId,
		]);
	});

	it("returns an empty list when the viewer tracks nothing", async () => {
		const db = await seededViewer();
		await seedSpyXFamily(db);

		expect(await clientFor(db, "user-1").library.list()).toEqual([]);
	});

	it("keeps the row when its metadata provider fails", async () => {
		const db = await seededViewer();
		const { continuityId } = await seedSpyXFamily(db);
		await track(db, continuityId, new Date("2026-01-01T00:00:00Z"));

		const entries = await clientFor(
			db,
			"user-1",
			providersUsing(brokenProvider),
		).library.list();

		expect(entries).toHaveLength(1);
		expect(entries[0]?.continuityId).toBe(continuityId);
		expect(entries[0]?.coverRef).toBeUndefined();
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

		expect(await clientFor(db, "user-2").library.list()).toEqual([]);
	});

	it("rejects a viewer without a session", async () => {
		const db = await seededViewer();

		await expect(clientFor(db, undefined).library.list()).rejects.toThrow(
			/sign in/iu,
		);
	});
});
