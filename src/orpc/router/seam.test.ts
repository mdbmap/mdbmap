import { createRouterClient } from "@orpc/server";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { describe, expect, it } from "vitest";

import { episodeProgress, personalRating, user } from "@/db/schema";
import { stubEngine } from "@/engine";

import type { ORPCContext } from "@/orpc/context";
import { instalmentsOf } from "@/orpc/instalments";
import { router } from "./index.ts";

const CONTINUITY = "continuity:spy-x-family";

const freshDb = () => {
	const sqlite = new Database(":memory:");
	sqlite.pragma("foreign_keys = ON");
	const db = drizzle(sqlite);
	migrate(db, { migrationsFolder: "schemas/drizzle" });
	db.insert(user).values({ email: "a@b.test", id: "user-1", name: "Ada" }).run();
	return db;
};

const clientFor = (db: ReturnType<typeof freshDb>, userId: string | undefined) =>
	createRouterClient(router, {
		context: {
			db,
			resolveSession: () =>
				userId === undefined ? undefined : { id: userId },
		} satisfies ORPCContext,
	});

describe("tracking + work.get seam", () => {
	it("completes the series once every instalment is watched", async () => {
		const db = freshDb();
		const client = clientFor(db, "user-1");
		const locators = instalmentsOf(stubEngine.resolveContinuity(CONTINUITY));

		const results = await Promise.all(
			locators.map(async (instalmentLocator) => {
				const result = await client.tracking.setEpisodeWatched({
					continuityId: CONTINUITY,
					instalmentLocator,
					watched: true,
				});
				return result;
			}),
		);

		expect(results.some((result) => result.status === "completed")).toBe(true);
		expect(db.select().from(episodeProgress).all()).toHaveLength(locators.length);

		const view = await client.work.get({ continuityId: CONTINUITY });
		expect(view.viewer?.status).toBe("completed");
		expect(view.parts[0]?.episodes.every((episode) => episode.watched)).toBe(true);
	});

	it("writes, clears, and range-checks a rating", async () => {
		const db = freshDb();
		const client = clientFor(db, "user-1");
		const unit = { key: CONTINUITY, kind: "work" } as const;

		await client.tracking.setRating({ score: 9, unit });
		expect(db.select().from(personalRating).all()).toHaveLength(1);

		await client.tracking.setRating({ unit });
		expect(db.select().from(personalRating).all()).toHaveLength(0);

		await expect(client.tracking.setRating({ score: 11, unit })).rejects.toThrow();
		await expect(client.tracking.setRating({ score: 0, unit })).rejects.toThrow();
	});

	it("serves metadata and ratings but no viewer when unauthenticated", async () => {
		const db = freshDb();
		const client = clientFor(db, undefined);

		db.insert(personalRating)
			.values({
				score: 9,
				unitKey: `part:${CONTINUITY}:0`,
				unitKind: "part",
				userId: "user-1",
			})
			.run();

		const view = await client.work.get({ continuityId: CONTINUITY });
		expect(view.viewer).toBeUndefined();
		expect(view.header.title).toBe("Spy × Family");
		expect(view.parts[0]?.serviceRatings.length).toBeGreaterThan(0);
		expect(view.parts[0]?.communityScore.count).toBeGreaterThan(0);
		expect(view.parts[0]?.episodes.every((episode) => !episode.watched)).toBe(true);

		await expect(
			client.tracking.setStatus({ continuityId: CONTINUITY, status: "watching" }),
		).rejects.toThrow();
	});
});
