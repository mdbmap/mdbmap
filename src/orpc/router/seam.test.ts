import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { episodeProgress, personalRating, user } from "@/db/schema";
import { freshDb } from "@/db/test-helpers";
import { createEngine } from "@/engine";
import { seedSpyXFamily } from "@/engine/test-continuity";

import type { ORPCContext } from "@/orpc/context";
import { instalmentsOf } from "@/orpc/instalments";
import { router } from "./index.ts";

const seeded = async () => {
	const db = await freshDb();
	await db.insert(user).values({ email: "a@b.test", id: "user-1", name: "Ada" }).run();
	const { continuityId } = await seedSpyXFamily(db);
	return { continuityId, db };
};

const locatorsFor = async (
	db: Awaited<ReturnType<typeof seeded>>["db"],
	continuityId: string,
) => instalmentsOf(await createEngine(db).resolveContinuity(continuityId));

const clientFor = (
	db: Awaited<ReturnType<typeof seeded>>["db"],
	userId: string | undefined,
) =>
	createRouterClient(router, {
		context: {
			db,
			resolveSession: () =>
				userId === undefined ? undefined : { id: userId },
		} satisfies ORPCContext,
	});

describe("tracking + work.get seam", () => {
	it("completes the series once every instalment is watched", async () => {
		const { continuityId, db } = await seeded();
		const client = clientFor(db, "user-1");
		const locators = await locatorsFor(db, continuityId);

		const results = await Promise.all(
			locators.map(async (instalmentLocator) => {
				const result = await client.tracking.setEpisodeWatched({
					continuityId,
					instalmentLocator,
					watched: true,
				});
				return result;
			}),
		);

		expect(results.some((result) => result.status === "completed")).toBe(true);
		expect(await db.select().from(episodeProgress).all()).toHaveLength(locators.length);

		const view = await client.work.get({ continuityId });
		expect(view.viewer?.status).toBe("completed");
		expect(view.parts[0]?.episodes.every((episode) => episode.watched)).toBe(true);
	});

	it("writes, clears, and range-checks a rating", async () => {
		const { continuityId, db } = await seeded();
		const client = clientFor(db, "user-1");
		const unit = { key: continuityId, kind: "work" } as const;

		await client.tracking.setRating({ score: 9, unit });
		expect(await db.select().from(personalRating).all()).toHaveLength(1);

		await client.tracking.setRating({ unit });
		expect(await db.select().from(personalRating).all()).toHaveLength(0);

		await expect(client.tracking.setRating({ score: 11, unit })).rejects.toThrow();
		await expect(client.tracking.setRating({ score: 0, unit })).rejects.toThrow();
	});

	it("serves metadata and ratings but no viewer when unauthenticated", async () => {
		const { continuityId, db } = await seeded();
		const client = clientFor(db, undefined);

		await db
			.insert(personalRating)
			.values({
				score: 9,
				unitKey: `part:${continuityId}:0`,
				unitKind: "part",
				userId: "user-1",
			})
			.run();

		const view = await client.work.get({ continuityId });
		expect(view.viewer).toBeUndefined();
		expect(view.header.title).toBe("Spy × Family");
		expect(view.parts[0]?.serviceRatings.length).toBeGreaterThan(0);
		expect(view.parts[0]?.communityScore.count).toBeGreaterThan(0);
		expect(view.parts[0]?.episodes.every((episode) => !episode.watched)).toBe(true);

		await expect(
			client.tracking.setStatus({ continuityId, status: "watching" }),
		).rejects.toThrow();
	});
});
