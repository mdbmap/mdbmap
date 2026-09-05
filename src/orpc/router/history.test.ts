import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { continuityAliases } from "@/db/engine-schema";
import { episodeProgress, user, watchStatus } from "@/db/schema";
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
	segments: resolved.segments.map((segment, index) => ({
		airedFrom: undefined,
		airedTo: undefined,
		episodes: segment.instalments.map((_locator, position) => ({
			airDate: undefined,
			number: position + 1,
			title: `Episode ${position + 1}`,
		})),
		label: segment.kind === "atomic" ? "The Matrix" : `Part ${index + 1}`,
		year: 2026,
	})),
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
	status: "completed" | "watching" = "watching",
) => {
	await db
		.insert(watchStatus)
		.values({
			continuityKey,
			rewatchCount: 0,
			status,
			updatedAt: new Date("2026-01-01T00:00:00Z"),
			userId: "user-1",
		})
		.run();
};

const locatorsFor = async (db: TestDb, continuityId: string) =>
	instalmentsOf(await createEngine(db).resolveContinuity(continuityId));

const markWatched = async (db: TestDb, locator: string, watchedAt: Date) => {
	await db
		.insert(episodeProgress)
		.values({
			instalmentLocator: locator,
			userId: "user-1",
			watchedAt,
		})
		.run();
};

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

const threeLocators = async (db: TestDb, continuityId: string) => {
	const locators = await locatorsFor(db, continuityId);
	const [first, second, third] = locators;
	if (first === undefined || second === undefined || third === undefined) {
		throw new Error("expected at least three instalment locators");
	}
	return { first, second, third };
};

describe("history.list", () => {
	it("lists watched instalments newest first with titles", async () => {
		const db = await seededViewer();
		const { continuityId } = await seedSpyXFamily(db);
		await track(db, continuityId);
		const { first, second, third } = await threeLocators(db, continuityId);
		await markWatched(db, first, new Date("2026-04-08T12:00:00.000Z"));
		await markWatched(db, second, new Date("2026-04-09T12:00:00.000Z"));
		await markWatched(db, third, new Date("2026-04-09T12:00:00.000Z"));

		const { entries, nextCursor } = await clientFor(db, "user-1").history.list(
			{},
		);

		expect(nextCursor).toBeUndefined();
		expect(entries).toEqual([
			{
				continuityId,
				coverRef: `https://img.test/${continuityId}.jpg`,
				instalmentTitle: "Episode 3",
				mediaKind: "anime",
				number: 3,
				partLabel: "Part 1",
				watchedAt: "2026-04-09T12:00:00.000Z",
				workTitle: `Work ${continuityId}`,
			},
			{
				continuityId,
				coverRef: `https://img.test/${continuityId}.jpg`,
				instalmentTitle: "Episode 2",
				mediaKind: "anime",
				number: 2,
				partLabel: "Part 1",
				watchedAt: "2026-04-09T12:00:00.000Z",
				workTitle: `Work ${continuityId}`,
			},
			{
				continuityId,
				coverRef: `https://img.test/${continuityId}.jpg`,
				instalmentTitle: "Episode 1",
				mediaKind: "anime",
				number: 1,
				partLabel: "Part 1",
				watchedAt: "2026-04-08T12:00:00.000Z",
				workTitle: `Work ${continuityId}`,
			},
		]);
	});

	it("pages newest-first with an opaque cursor", async () => {
		const db = await seededViewer();
		const { continuityId } = await seedSpyXFamily(db);
		await track(db, continuityId);
		const { first, second, third } = await threeLocators(db, continuityId);
		await markWatched(db, first, new Date("2026-04-08T12:00:00.000Z"));
		await markWatched(db, second, new Date("2026-04-09T12:00:00.000Z"));
		await markWatched(db, third, new Date("2026-04-10T12:00:00.000Z"));
		const client = clientFor(db, "user-1");

		const firstPage = await client.history.list({ limit: 2 });
		expect(firstPage.entries.map((entry) => entry.instalmentTitle)).toEqual([
			"Episode 3",
			"Episode 2",
		]);
		const cursor = firstPage.nextCursor;
		if (cursor === undefined) {
			throw new Error("expected a history cursor");
		}

		const secondPage = await client.history.list({ cursor, limit: 2 });
		expect(secondPage.entries.map((entry) => entry.instalmentTitle)).toEqual([
			"Episode 1",
		]);
		expect(secondPage.nextCursor).toBeUndefined();
	});

	it("includes completed and watching works", async () => {
		const db = await seededViewer();
		const spy = await seedSpyXFamily(db);
		const film = await seedTmdbContinuity(db, "movie", "603");
		await track(db, spy.continuityId, "watching");
		await track(db, film.continuityId, "completed");
		const [episode] = await locatorsFor(db, spy.continuityId);
		const [movie] = await locatorsFor(db, film.continuityId);
		if (episode === undefined || movie === undefined) {
			throw new Error("expected locators for both works");
		}
		await markWatched(db, episode, new Date("2026-04-08T12:00:00.000Z"));
		await markWatched(db, movie, new Date("2026-04-09T12:00:00.000Z"));

		const { entries } = await clientFor(db, "user-1").history.list({});

		expect(entries).toEqual([
			expect.objectContaining({
				continuityId: film.continuityId,
				instalmentTitle: "The Matrix",
				mediaKind: "film",
				number: 1,
				partLabel: "Film",
				watchedAt: "2026-04-09T12:00:00.000Z",
			}),
			expect.objectContaining({
				continuityId: spy.continuityId,
				instalmentTitle: "Episode 1",
				mediaKind: "anime",
				number: 1,
				partLabel: "Part 1",
				watchedAt: "2026-04-08T12:00:00.000Z",
			}),
		]);
	});

	it("omits locators that do not belong to a tracked continuity", async () => {
		const db = await seededViewer();
		const { continuityId } = await seedSpyXFamily(db);
		await track(db, continuityId);
		const [locator] = await locatorsFor(db, continuityId);
		if (locator === undefined) {
			throw new Error("expected an instalment locator");
		}
		await markWatched(db, locator, new Date("2026-04-09T12:00:00.000Z"));
		await markWatched(
			db,
			"orphan:locator",
			new Date("2026-04-10T12:00:00.000Z"),
		);

		const { entries } = await clientFor(db, "user-1").history.list({});

		expect(entries).toHaveLength(1);
		expect(entries[0]?.instalmentTitle).toBe("Episode 1");
	});

	it("collapses retired continuities onto one history row", async () => {
		const db = await seededViewer();
		const survivor = await seedSpyXFamily(db);
		const retired = await seedCrossGroupContinuity(db);
		await retireInto(db, survivor.continuityId, retired.continuityId);
		await track(db, survivor.continuityId);
		await track(db, retired.continuityId);
		const [locator] = await locatorsFor(db, survivor.continuityId);
		if (locator === undefined) {
			throw new Error("expected an instalment locator");
		}
		await markWatched(db, locator, new Date("2026-04-09T12:00:00.000Z"));

		const { entries } = await clientFor(db, "user-1").history.list({});

		expect(entries).toHaveLength(1);
		expect(entries[0]?.continuityId).toBe(survivor.continuityId);
	});

	it("returns an empty list when nothing is watched", async () => {
		const db = await seededViewer();
		const { continuityId } = await seedSpyXFamily(db);
		await track(db, continuityId);

		expect(await clientFor(db, "user-1").history.list({})).toEqual({
			entries: [],
		});
	});

	it("rejects a viewer without a session", async () => {
		const db = await seededViewer();

		await expect(clientFor(db, undefined).history.list({})).rejects.toThrow(
			/sign in/iu,
		);
	});

	it("treats an undecodable cursor as the first page", async () => {
		const db = await seededViewer();
		const { continuityId } = await seedSpyXFamily(db);
		await track(db, continuityId);
		const { first } = await threeLocators(db, continuityId);
		await markWatched(db, first, new Date("2026-04-08T12:00:00.000Z"));
		const client = clientFor(db, "user-1");

		expect(await client.history.list({ cursor: "not-a-cursor" })).toEqual(
			await client.history.list({}),
		);
	});
});
