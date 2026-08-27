import { createRouterClient } from "@orpc/server";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { continuitySegments } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import { createEngine } from "@/engine";
import { parseContinuityKey } from "@/engine/continuity/keys";
import { persistWatchOrder } from "@/engine/continuity/orders";
import { seedSpyXFamily } from "@/engine/test-continuity";
import type { ORPCContext, SessionUser } from "@/orpc/context";
import { WorkGetInput } from "@/orpc/schema";

import { router } from "./index.ts";

const clientFor = (
	db: Awaited<ReturnType<typeof freshDb>>,
	user?: SessionUser,
) =>
	createRouterClient(router, {
		context: {
			db,
			resolveSession: () => user,
		} satisfies ORPCContext,
	});

const locatorsOf = (parts: { episodes: { instalmentLocator: string }[] }[]) =>
	parts.flatMap((part) =>
		part.episodes.map((episode) => episode.instalmentLocator),
	);

const partKeyByLocator = (
	parts: {
		episodes: { instalmentLocator: string }[];
		rateableUnit: { key: string };
	}[],
) =>
	Object.fromEntries(
		parts.flatMap((part) =>
			part.episodes.map((episode) => [
				episode.instalmentLocator,
				part.rateableUnit.key,
			]),
		),
	);

describe("work.get presentation orders", () => {
	it("rejects matching-order slugs at the input boundary", () => {
		expect(() =>
			WorkGetInput.parse({
				continuityId: "continuity:1",
				order: "t1-structure",
			}),
		).toThrow();
		expect(
			WorkGetInput.parse({ continuityId: "continuity:1", order: "watch" }),
		).toEqual({
			continuityId: "continuity:1",
			order: "watch",
		});
	});

	it("returns the same blocks in watch vs release sequence", async () => {
		const db = await freshDb();
		const { continuityId } = await seedSpyXFamily(db);
		const client = clientFor(db);
		const resolved = await createEngine(db).resolveContinuity(continuityId);
		const parsed = parseContinuityKey(resolved.continuityId);
		if (parsed?.type !== "continuity") {
			throw new Error("expected a canonical continuity");
		}
		const segments = await db
			.select()
			.from(continuitySegments)
			.where(eq(continuitySegments.continuityId, parsed.id))
			.orderBy(asc(continuitySegments.releaseOrdinal))
			.all();
		await persistWatchOrder(db, {
			continuityId: parsed.id,
			segmentIds: segments.toReversed().map((segment) => segment.id),
		});

		const release = await client.work.get({
			continuityId,
			order: "release",
		});
		const watch = await client.work.get({
			continuityId,
			order: "watch",
		});
		const fallback = await client.work.get({ continuityId });

		expect(release.parts.length).toBeGreaterThan(1);
		expect(
			watch.parts.map((part) => part.episodes[0]?.instalmentLocator),
		).toEqual(
			[...release.parts]
				.toReversed()
				.map((part) => part.episodes[0]?.instalmentLocator),
		);
		expect(locatorsOf(watch.parts).toSorted()).toEqual(
			locatorsOf(release.parts).toSorted(),
		);
		expect(partKeyByLocator(watch.parts)).toEqual(
			partKeyByLocator(release.parts),
		);
		expect(
			watch.parts.map((part) => part.episodes[0]?.instalmentLocator),
		).toEqual(
			fallback.parts.map((part) => part.episodes[0]?.instalmentLocator),
		);
		expect(JSON.stringify(watch)).not.toMatch(/matching.?order/iu);
	});
});
