import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import {
	episodeProgress,
	personalRating,
	user,
	watchStatus,
} from "@/db/schema";
import { freshDb } from "@/db/test-helpers";
import { createEngine } from "@/engine";
import { seedSpyXFamily } from "@/engine/test-continuity";
import type { ORPCContext } from "@/orpc/context";
import { instalmentsOf } from "@/orpc/instalments";
import { defaultProviders } from "@/orpc/providers";
import type { Providers } from "@/orpc/providers";

import { router } from "./index.ts";

const seeded = async () => {
	const db = await freshDb();
	await db
		.insert(user)
		.values({ email: "a@b.test", id: "user-1", name: "Ada" })
		.run();
	const { continuityId } = await seedSpyXFamily(db);
	return { continuityId, db };
};

const locatorsFor = async (
	db: Awaited<ReturnType<typeof seeded>>["db"],
	continuityId: string,
) => instalmentsOf(await createEngine(db).resolveContinuity(continuityId));

const stubRating = {
	kind: "user" as const,
	scale: 10,
	score: 8.5,
	service: "mal",
	votes: 1000,
};

const stubRatings: Providers = {
	...defaultProviders,
	serviceRatings: {
		ratingsFor: async () => {
			await Promise.resolve();
			return [stubRating];
		},
	},
};

const clientFor = (
	db: Awaited<ReturnType<typeof seeded>>["db"],
	userId: string | undefined,
	providers: Providers = stubRatings,
) =>
	createRouterClient(router, {
		context: {
			db,
			providers,
			resolveSession: () => (userId === undefined ? undefined : { id: userId }),
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
		expect(await db.select().from(episodeProgress).all()).toHaveLength(
			locators.length,
		);

		const view = await client.work.get({ continuityId });
		expect(view.viewer?.status).toBe("completed");
		expect(view.parts[0]?.episodes.every((episode) => episode.watched)).toBe(
			true,
		);
	});

	it("writes, clears, and range-checks a rating", async () => {
		const { continuityId, db } = await seeded();
		const client = clientFor(db, "user-1");
		const unit = { key: continuityId, kind: "work" } as const;

		await client.tracking.setRating({ score: 9, unit });
		expect(await db.select().from(personalRating).all()).toHaveLength(1);
		const rated = await client.work.get({ continuityId });
		expect(rated.communityScore).toEqual({ count: 1, mean: 9 });
		expect(rated.viewer?.personalRating).toBe(9);

		await client.tracking.setRating({ unit });
		expect(await db.select().from(personalRating).all()).toHaveLength(0);

		await expect(
			client.tracking.setRating({ score: 11, unit }),
		).rejects.toThrow();
		await expect(
			client.tracking.setRating({ score: 0, unit }),
		).rejects.toThrow();
	});

	it("reads legacy tracking through the canonical continuity", async () => {
		const { continuityId: requestedId, db } = await seeded();
		const resolved = await createEngine(db).resolveContinuity(requestedId);
		const canonicalId = resolved.continuityId;
		await db
			.insert(watchStatus)
			.values({
				continuityKey: requestedId,
				status: "watching",
				userId: "user-1",
			})
			.run();
		const client = clientFor(db, "user-1");

		const legacy = await client.work.get({ continuityId: requestedId });
		expect(legacy.continuityId).toBe(canonicalId);
		expect(legacy.viewer?.status).toBe("watching");

		await client.tracking.setStatus({
			continuityId: requestedId,
			status: "completed",
		});
		const canonical = await client.work.get({ continuityId: requestedId });
		expect(canonical.viewer?.status).toBe("completed");
		const rows = await db.select().from(watchStatus).all();
		expect(rows.map((row) => row.continuityKey)).toContain(canonicalId);
	});

	it("serves metadata and ratings but no viewer when unauthenticated", async () => {
		const { continuityId, db } = await seeded();
		const client = clientFor(db, undefined, stubRatings);

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
		expect(view.communityScore).toEqual({ count: 0, mean: undefined });
		expect(view.parts[0]?.serviceRatings.length).toBeGreaterThan(0);
		expect(view.parts[0]?.communityScore.count).toBeGreaterThan(0);
		expect(view.parts[0]?.episodes.every((episode) => !episode.watched)).toBe(
			true,
		);

		await expect(
			client.tracking.setStatus({ continuityId, status: "watching" }),
		).rejects.toThrow();
	});
});
