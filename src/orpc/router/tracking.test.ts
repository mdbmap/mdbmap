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
import { createEngine } from "@/engine";
import { parseContinuityKey } from "@/engine/continuity/keys";
import {
	seedCrossGroupContinuity,
	seedSpyXFamily,
} from "@/engine/test-continuity";
import type { ORPCContext } from "@/orpc/context";
import { instalmentsOf } from "@/orpc/instalments";

import { router } from "./index.ts";

const FILM_LOCATOR = "anidb:1002#1";
const MOVIE_UNIT = { key: FILM_LOCATOR, kind: "movie" } as const;

const seeded = async () => {
	const db = await freshDb();
	await db
		.insert(user)
		.values({ email: "a@b.test", id: "user-1", name: "Ada" })
		.run();
	const { continuityId } = await seedCrossGroupContinuity(db);
	return { continuityId, db };
};

const clientFor = (
	db: Awaited<ReturnType<typeof seeded>>["db"],
	userId: string | undefined,
) =>
	createRouterClient(router, {
		context: {
			db,
			resolveSession: () => (userId === undefined ? undefined : { id: userId }),
		} satisfies ORPCContext,
	});

describe("tracking film locators and movie units", () => {
	it("persists a movie rating and shows it on the film block", async () => {
		const { continuityId, db } = await seeded();
		const client = clientFor(db, "user-1");

		const result = await client.tracking.setRating({
			score: 8,
			unit: MOVIE_UNIT,
		});
		expect(result).toEqual({ score: 8, unit: MOVIE_UNIT });
		expect(await db.select().from(personalRating).all()).toEqual([
			expect.objectContaining({
				score: 8,
				unitKey: FILM_LOCATOR,
				unitKind: "movie",
				userId: "user-1",
			}),
		]);

		const view = await client.work.get({ continuityId });
		const film = view.parts.find((part) => part.kind === "film");
		expect(film?.personalRating).toBe(8);
		expect(film?.rateableUnit).toEqual(MOVIE_UNIT);
	});

	it("toggles the film locator and completes the work on the last instalment", async () => {
		const { continuityId, db } = await seeded();
		const client = clientFor(db, "user-1");
		const locators = instalmentsOf(
			await createEngine(db).resolveContinuity(continuityId),
		);
		expect(locators).toContain(FILM_LOCATOR);

		const prior = await Promise.all(
			locators
				.filter((locator) => locator !== FILM_LOCATOR)
				.map(async (instalmentLocator) =>
					client.tracking.setEpisodeWatched({
						continuityId,
						instalmentLocator,
						watched: true,
					}),
				),
		);
		expect(prior.every((result) => result.status === "watching")).toBe(true);

		const last = await client.tracking.setEpisodeWatched({
			continuityId,
			instalmentLocator: FILM_LOCATOR,
			watched: true,
		});
		expect(last.status).toBe("completed");
		expect(last.watched.toSorted()).toEqual([...locators].toSorted());
		expect(await db.select().from(episodeProgress).all()).toHaveLength(
			locators.length,
		);

		const view = await client.work.get({ continuityId });
		const film = view.parts.find((part) => part.kind === "film");
		expect(film?.kind === "film" && film.watched).toBe(true);
		expect(view.viewer?.status).toBe("completed");

		const cleared = await client.tracking.setEpisodeWatched({
			continuityId,
			instalmentLocator: FILM_LOCATOR,
			watched: false,
		});
		expect(cleared.status).toBe("watching");
		const after = await client.work.get({ continuityId });
		const afterFilm = after.parts.find((part) => part.kind === "film");
		expect(afterFilm?.kind === "film" && afterFilm.watched).toBe(false);
	});
});

const MISSING_CONTINUITY = "continuity:999999";
const WORK_SCORE = 7;

const retireInto = async (
	db: Awaited<ReturnType<typeof seeded>>["db"],
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

describe("tracking.remove", () => {
	it("clears watch status and episode progress and keeps the personal rating", async () => {
		const { continuityId, db } = await seeded();
		const client = clientFor(db, "user-1");
		const locators = instalmentsOf(
			await createEngine(db).resolveContinuity(continuityId),
		);
		expect(locators).toContain(FILM_LOCATOR);

		await client.tracking.setStatus({
			continuityId,
			status: "watching",
		});
		await client.tracking.setEpisodeWatched({
			continuityId,
			instalmentLocator: FILM_LOCATOR,
			watched: true,
		});
		await client.tracking.setRating({
			score: WORK_SCORE,
			unit: { key: continuityId, kind: "work" },
		});

		expect(await client.tracking.remove({ continuityId })).toEqual({
			removed: true,
		});
		expect(await db.select().from(watchStatus).all()).toEqual([]);
		expect(await db.select().from(episodeProgress).all()).toEqual([]);
		expect(await db.select().from(personalRating).all()).toEqual([
			expect.objectContaining({
				score: WORK_SCORE,
				unitKey: continuityId,
				unitKind: "work",
				userId: "user-1",
			}),
		]);
		expect(await client.tracking.remove({ continuityId })).toEqual({
			removed: true,
		});
	});

	it("deletes watch status stored under retired alias keys", async () => {
		const db = await freshDb();
		await db
			.insert(user)
			.values({ email: "a@b.test", id: "user-1", name: "Ada" })
			.run();
		const survivor = await seedSpyXFamily(db);
		const retired = await seedCrossGroupContinuity(db);
		await retireInto(db, survivor.continuityId, retired.continuityId);
		const client = clientFor(db, "user-1");
		const locators = instalmentsOf(
			await createEngine(db).resolveContinuity(survivor.continuityId),
		);
		const [locator] = locators;
		if (locator === undefined) {
			throw new Error("expected an instalment locator");
		}

		await client.tracking.setStatus({
			continuityId: survivor.continuityId,
			status: "completed",
		});
		await db
			.insert(watchStatus)
			.values({
				continuityKey: retired.continuityId,
				status: "watching",
				userId: "user-1",
			})
			.run();
		await client.tracking.setEpisodeWatched({
			continuityId: retired.continuityId,
			instalmentLocator: locator,
			watched: true,
		});

		expect(
			await client.tracking.remove({ continuityId: retired.continuityId }),
		).toEqual({ removed: true });
		expect(await db.select().from(watchStatus).all()).toEqual([]);
		expect(await db.select().from(episodeProgress).all()).toEqual([]);
	});

	it("clears a dangling watch-status row when the continuity is missing", async () => {
		const { continuityId, db } = await seeded();
		const client = clientFor(db, "user-1");
		await client.tracking.setStatus({
			continuityId,
			status: "watching",
		});
		await db
			.insert(watchStatus)
			.values({
				continuityKey: MISSING_CONTINUITY,
				status: "dropped",
				userId: "user-1",
			})
			.run();

		expect(
			await client.tracking.remove({ continuityId: MISSING_CONTINUITY }),
		).toEqual({ removed: true });
		expect(await db.select().from(watchStatus).all()).toEqual([
			expect.objectContaining({
				continuityKey: continuityId,
				status: "watching",
				userId: "user-1",
			}),
		]);
	});

	it("leaves another viewer's tracking intact", async () => {
		const { continuityId, db } = await seeded();
		await db
			.insert(user)
			.values({ email: "b@b.test", id: "user-2", name: "Bea" })
			.run();
		const owner = clientFor(db, "user-1");
		const other = clientFor(db, "user-2");
		await owner.tracking.setStatus({ continuityId, status: "watching" });
		await other.tracking.setStatus({ continuityId, status: "completed" });

		expect(await owner.tracking.remove({ continuityId })).toEqual({
			removed: true,
		});
		expect(await db.select().from(watchStatus).all()).toEqual([
			expect.objectContaining({
				continuityKey: continuityId,
				status: "completed",
				userId: "user-2",
			}),
		]);
	});

	it("rejects a viewer without a session", async () => {
		const { continuityId, db } = await seeded();

		await expect(
			clientFor(db, undefined).tracking.remove({ continuityId }),
		).rejects.toThrow(/sign in/iu);
	});
});
