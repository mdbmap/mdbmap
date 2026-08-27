import { createRouterClient } from "@orpc/server";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { continuitySegments } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import { createEngine } from "@/engine";
import { parseContinuityKey } from "@/engine/continuity/keys";
import { persistWatchOrder } from "@/engine/continuity/orders";
import {
	seedCrossGroupContinuity,
	seedSpyXFamily,
} from "@/engine/test-continuity";
import type { ORPCContext, SessionUser } from "@/orpc/context";
import type { PartView } from "@/orpc/schema";
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

const locatorsOf = (parts: PartView[]) =>
	parts.flatMap((part) =>
		part.instalmentLocator === undefined
			? part.episodes.map((episode) => episode.instalmentLocator)
			: [part.instalmentLocator],
	);

const partKeyByLocator = (parts: PartView[]) =>
	Object.fromEntries(
		parts.flatMap((part) => {
			if (part.instalmentLocator !== undefined) {
				return [[part.instalmentLocator, part.rateableUnit.key]];
			}
			return part.episodes.map((episode) => [
				episode.instalmentLocator,
				part.rateableUnit.key,
			]);
		}),
	);

const firstLocator = (part: PartView) =>
	part.instalmentLocator ?? part.episodes[0]?.instalmentLocator;

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
		expect(watch.parts.map((part) => firstLocator(part))).toEqual(
			[...release.parts].toReversed().map((part) => firstLocator(part)),
		);
		expect(locatorsOf(watch.parts).toSorted()).toEqual(
			locatorsOf(release.parts).toSorted(),
		);
		expect(partKeyByLocator(watch.parts)).toEqual(
			partKeyByLocator(release.parts),
		);
		expect(watch.parts.map((part) => firstLocator(part))).toEqual(
			fallback.parts.map((part) => firstLocator(part)),
		);
		expect(release.parts.every((part) => part.kind === "part")).toBe(true);
		expect(JSON.stringify(watch)).not.toMatch(/matching.?order/iu);
	});
});

describe("work.get film blocks", () => {
	it("returns a film block on the film title locator, not a series SxEy", async () => {
		const db = await freshDb();
		const { continuityId } = await seedCrossGroupContinuity(db);
		const client = clientFor(db);
		const view = await client.work.get({ continuityId });
		const [series, film] = view.parts;

		expect(view.parts.map((part) => part.kind)).toEqual(["part", "film"]);
		expect(series?.kind).not.toBe("film");
		expect(series?.rateableUnit).toEqual({
			key: `part:${view.continuityId}:0`,
			kind: "part",
		});
		expect(film).toEqual(
			expect.objectContaining({
				episodes: [],
				instalmentLocator: "anidb:1002#1",
				kind: "film",
				rateableUnit: { key: "anidb:1002#1", kind: "movie" },
				watched: false,
			}),
		);
		expect(film?.instalmentLocator).not.toMatch(/s\d+e\d+/iu);
		expect(locatorsOf(view.parts)).toEqual([
			"anidb:1001#1",
			"anidb:1001#2",
			"anidb:1002#1",
		]);
	});

	it("keeps episodic part keys stable when watch order puts the film first", async () => {
		const db = await freshDb();
		const { continuityId } = await seedCrossGroupContinuity(db);
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
		const partKey = `part:${release.continuityId}:0`;

		expect(release.parts.map((part) => part.kind)).toEqual(["part", "film"]);
		expect(watch.parts.map((part) => part.kind)).toEqual(["film", "part"]);
		expect(partKeyByLocator(watch.parts)).toEqual(
			partKeyByLocator(release.parts),
		);
		expect(
			release.parts.find((part) => part.kind !== "film")?.rateableUnit.key,
		).toBe(partKey);
		expect(
			watch.parts.find((part) => part.kind !== "film")?.rateableUnit.key,
		).toBe(partKey);
		expect(locatorsOf(watch.parts).toSorted()).toEqual(
			locatorsOf(release.parts).toSorted(),
		);
	});
});
