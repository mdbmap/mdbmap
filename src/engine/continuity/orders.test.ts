import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
	continuitySegments,
	presentationOrderItems,
	presentationOrders,
	relationAssertions,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";

import {
	defaultPresentationSlug,
	persistWatchOrder,
	reorderByIds,
	resolvePresentationSlug,
	selectPresentationOrder,
} from "./orders.ts";
import { ensureGroupContinuity, upsertRelationContinuity } from "./persist.ts";

const one = <Row>(rows: readonly Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected inserted row");
	}
	return row;
};

const itemsFor = async (
	db: Awaited<ReturnType<typeof freshDb>>,
	continuityId: number,
	slug: "release" | "watch",
) =>
	db
		.select({
			position: presentationOrderItems.position,
			titleId: continuitySegments.titleId,
		})
		.from(presentationOrderItems)
		.innerJoin(
			presentationOrders,
			eq(presentationOrderItems.orderId, presentationOrders.id),
		)
		.innerJoin(
			continuitySegments,
			eq(presentationOrderItems.segmentId, continuitySegments.id),
		)
		.where(
			and(
				eq(presentationOrders.continuityId, continuityId),
				eq(presentationOrders.slug, slug),
			),
		)
		.orderBy(asc(presentationOrderItems.position))
		.all();

describe("presentation slug selection", () => {
	it("uses the only stored slug, else watch when both exist", () => {
		expect(defaultPresentationSlug(["release"])).toBe("release");
		expect(defaultPresentationSlug(["watch"])).toBe("watch");
		expect(defaultPresentationSlug(["release", "watch"])).toBe("watch");
		expect(resolvePresentationSlug(["release", "watch"], "release")).toBe(
			"release",
		);
		expect(resolvePresentationSlug(["release"], "watch")).toBe("release");
	});

	it("reorders the same identities by a presentation id list", () => {
		expect(reorderByIds(["a", "b", "c"], [1, 2, 3], [3, 1, 2])).toEqual([
			"c",
			"a",
			"b",
		]);
	});
});

describe("persisted presentation orders", () => {
	it("seeds a release order from segment ordinals", async () => {
		const db = await freshDb();
		const group = one(
			await db
				.insert(titleGroups)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		const first = one(
			await db
				.insert(serviceTitles)
				.values({
					groupId: group.id,
					ordinal: 0,
					service: "tmdb",
					serviceId: "tv:1",
				})
				.returning()
				.all(),
		);
		const second = one(
			await db
				.insert(serviceTitles)
				.values({
					groupId: group.id,
					ordinal: 1,
					service: "tmdb",
					serviceId: "tv:2",
				})
				.returning()
				.all(),
		);

		const continuityId = await ensureGroupContinuity(db, group.id);
		const selected = await selectPresentationOrder(db, continuityId);

		expect(selected.slug).toBe("release");
		expect(await itemsFor(db, continuityId, "release")).toEqual([
			{ position: 0, titleId: first.id },
			{ position: 1, titleId: second.id },
		]);
		expect(await db.select().from(presentationOrders).all()).toEqual([
			expect.objectContaining({
				continuityId,
				isDefault: true,
				slug: "release",
			}),
		]);
	});

	it("refreshes release on rediscovery without mutating a stored watch order", async () => {
		const db = await freshDb();
		const seriesGroup = one(
			await db
				.insert(titleGroups)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		const filmGroup = one(
			await db
				.insert(titleGroups)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		const extraGroup = one(
			await db
				.insert(titleGroups)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		const season = one(
			await db
				.insert(serviceTitles)
				.values({
					groupId: seriesGroup.id,
					service: "tmdb",
					serviceId: "tv:10",
				})
				.returning()
				.all(),
		);
		const film = one(
			await db
				.insert(serviceTitles)
				.values({
					groupId: filmGroup.id,
					service: "tmdb",
					serviceId: "movie:11",
				})
				.returning()
				.all(),
		);
		const extra = one(
			await db
				.insert(serviceTitles)
				.values({
					groupId: extraGroup.id,
					service: "tmdb",
					serviceId: "movie:12",
				})
				.returning()
				.all(),
		);
		const seriesContinuity = await ensureGroupContinuity(db, seriesGroup.id);
		const firstJoin = one(
			await db
				.insert(relationAssertions)
				.values({
					confidence: "high",
					fromTitleId: season.id,
					source: "t1-structure",
					toTitleId: film.id,
				})
				.returning()
				.all(),
		);
		await upsertRelationContinuity(db, {
			fromTitleId: season.id,
			relationAssertionId: firstJoin.id,
			source: "t1-structure",
			toTitleId: film.id,
		});
		const before = await db
			.select()
			.from(continuitySegments)
			.where(eq(continuitySegments.continuityId, seriesContinuity))
			.orderBy(asc(continuitySegments.releaseOrdinal))
			.all();
		await persistWatchOrder(db, {
			continuityId: seriesContinuity,
			segmentIds: before.toReversed().map((segment) => segment.id),
		});
		const watchBefore = await itemsFor(db, seriesContinuity, "watch");

		const secondJoin = one(
			await db
				.insert(relationAssertions)
				.values({
					confidence: "high",
					fromTitleId: film.id,
					source: "t1-structure",
					toTitleId: extra.id,
				})
				.returning()
				.all(),
		);
		await upsertRelationContinuity(db, {
			fromTitleId: film.id,
			relationAssertionId: secondJoin.id,
			source: "t1-structure",
			toTitleId: extra.id,
		});

		expect(await itemsFor(db, seriesContinuity, "release")).toEqual([
			{ position: 0, titleId: season.id },
			{ position: 1, titleId: film.id },
			{ position: 2, titleId: extra.id },
		]);
		expect(await itemsFor(db, seriesContinuity, "watch")).toEqual(watchBefore);
		expect(watchBefore.map((item) => item.titleId)).toEqual([
			film.id,
			season.id,
		]);
		const selected = await selectPresentationOrder(db, seriesContinuity);
		expect(selected.slug).toBe("watch");
	});
});
