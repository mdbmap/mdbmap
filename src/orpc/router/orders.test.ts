import { createRouterClient } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
	continuitySegments,
	presentationOrderItems,
	presentationOrders,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import { regenerateReleaseOrder } from "@/engine/continuity/orders";
import { ensureGroupContinuity } from "@/engine/continuity/persist";
import type { ORPCContext, SessionUser } from "@/orpc/context";

import { router } from "./index.ts";
import { ContinuityIdInput, SaveWatchOrderInput } from "./orders.ts";

const one = <Row>(rows: readonly Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected inserted row");
	}
	return row;
};

const clientFor = (
	db: Awaited<ReturnType<typeof freshDb>>,
	user: SessionUser | undefined,
) =>
	createRouterClient(router, {
		context: {
			db,
			resolveSession: () => user,
		} satisfies ORPCContext,
	});

const seedContinuity = async (
	db: Awaited<ReturnType<typeof freshDb>>,
	count: number,
) => {
	const group = one(
		await db
			.insert(titleGroups)
			.values({ source: "t1-structure" })
			.returning()
			.all(),
	);
	await Promise.all(
		Array.from({ length: count }, async (_ignored, ordinal) =>
			db
				.insert(serviceTitles)
				.values({
					groupId: group.id,
					ordinal,
					service: "tmdb",
					serviceId: `tv:${group.id}-${ordinal + 1}`,
				})
				.run(),
		),
	);
	const continuityId = await ensureGroupContinuity(db, group.id);
	const segments = await db
		.select({ id: continuitySegments.id, titleId: continuitySegments.titleId })
		.from(continuitySegments)
		.where(eq(continuitySegments.continuityId, continuityId))
		.orderBy(asc(continuitySegments.releaseOrdinal))
		.all();
	return { continuityId, segments };
};

const watchItems = async (
	db: Awaited<ReturnType<typeof freshDb>>,
	continuityId: number,
) =>
	db
		.select({
			position: presentationOrderItems.position,
			segmentId: presentationOrderItems.segmentId,
		})
		.from(presentationOrderItems)
		.innerJoin(
			presentationOrders,
			eq(presentationOrderItems.orderId, presentationOrders.id),
		)
		.where(
			and(
				eq(presentationOrders.continuityId, continuityId),
				eq(presentationOrders.slug, "watch"),
			),
		)
		.orderBy(asc(presentationOrderItems.position))
		.all();

const adminUser: SessionUser = { id: "admin-1", role: "admin" };

describe("orders admin gate", () => {
	it("rejects get and saveWatch for unauthenticated and non-admin callers", async () => {
		const db = await freshDb();
		const anon = clientFor(db, undefined);
		const member = clientFor(db, { id: "user-1" });
		await expect(anon.orders.get({ continuityId: 1 })).rejects.toThrow();
		await expect(
			anon.orders.saveWatch({ continuityId: 1, segmentIds: [1] }),
		).rejects.toThrow();
		await expect(member.orders.get({ continuityId: 1 })).rejects.toThrow();
		await expect(
			member.orders.saveWatch({ continuityId: 1, segmentIds: [1] }),
		).rejects.toThrow();
	});
});

describe("orders input boundary", () => {
	it("rejects an empty or duplicate watch list", () => {
		expect(() =>
			SaveWatchOrderInput.parse({ continuityId: 1, segmentIds: [] }),
		).toThrow();
		expect(() =>
			SaveWatchOrderInput.parse({ continuityId: 1, segmentIds: [2, 2] }),
		).toThrow();
		expect(ContinuityIdInput.parse({ continuityId: 3 })).toEqual({
			continuityId: 3,
		});
	});
});

describe("orders admin surface", () => {
	it("returns segments and no watch overlay before curation", async () => {
		const db = await freshDb();
		const { continuityId, segments } = await seedContinuity(db, 2);
		const client = clientFor(db, adminUser);

		const view = await client.orders.get({ continuityId });
		expect(view.continuityId).toBe(continuityId);
		expect(view.watchSegmentIds).toBeUndefined();
		expect(view.releaseSegmentIds).toEqual(
			segments.map((segment) => segment.id),
		);
		expect(view.segments.map((segment) => segment.titleId)).toEqual(
			segments.map((segment) => segment.titleId),
		);
		expect(view.segments.every((segment) => segment.service === "tmdb")).toBe(
			true,
		);
	});

	it("persists a watch order through persistWatchOrder and keeps it after release regeneration", async () => {
		const db = await freshDb();
		const { continuityId, segments } = await seedContinuity(db, 3);
		const client = clientFor(db, adminUser);
		const [first, second, third] = segments;
		if (first === undefined || second === undefined || third === undefined) {
			throw new Error("expected three segments");
		}
		const curated = [third.id, first.id];

		const saved = await client.orders.saveWatch({
			continuityId,
			segmentIds: curated,
		});
		expect(saved.watchSegmentIds).toEqual(curated);
		expect(await watchItems(db, continuityId)).toEqual([
			{ position: 0, segmentId: third.id },
			{ position: 1, segmentId: first.id },
		]);

		await regenerateReleaseOrder(db, continuityId);

		const after = await client.orders.get({ continuityId });
		expect(after.watchSegmentIds).toEqual(curated);
		expect(after.releaseSegmentIds).toEqual([first.id, second.id, third.id]);
		expect(await watchItems(db, continuityId)).toEqual([
			{ position: 0, segmentId: third.id },
			{ position: 1, segmentId: first.id },
		]);
	});

	it("rejects a foreign segment id", async () => {
		const db = await freshDb();
		const first = await seedContinuity(db, 1);
		const second = await seedContinuity(db, 1);
		const client = clientFor(db, adminUser);
		const [foreign] = second.segments;
		if (foreign === undefined) {
			throw new Error("expected a foreign segment");
		}

		await expect(
			client.orders.saveWatch({
				continuityId: first.continuityId,
				segmentIds: [foreign.id],
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("maps a missing continuity to NOT_FOUND", async () => {
		const db = await freshDb();
		const client = clientFor(db, adminUser);
		await expect(client.orders.get({ continuityId: 99 })).rejects.toMatchObject(
			{
				code: "NOT_FOUND",
			},
		);
	});
});
