import { describe, expect, it } from "vitest";

import { episodeProgress, user, watchStatus } from "@/db/schema";
import { freshDb } from "@/db/test-helpers";

import { persistProgressAndStatus } from "./persist-progress.ts";

const USER_ID = "user-1";
const CONTINUITY_ID = "continuity:1";
const OWNED = ["anidb:1#1", "anidb:1#2"] as const;
const INSERT_OVER_BIND_LIMIT = 51;
const OWNED_OVER_BIND_LIMIT = 101;

const locatorsOf = (count: number): string[] => {
	const locators: string[] = [];
	let index = 1;
	while (index <= count) {
		locators.push(`anidb:1#${String(index)}`);
		index += 1;
	}
	return locators;
};

const seedUser = async () => {
	const db = await freshDb();
	await db
		.insert(user)
		.values({ email: "a@b.test", id: USER_ID, name: "Ada" })
		.run();
	return db;
};

const persist = async (
	db: Awaited<ReturnType<typeof seedUser>>,
	locators: readonly string[],
	watched: boolean,
	owned: readonly string[] = OWNED,
) =>
	persistProgressAndStatus({
		continuityId: CONTINUITY_ID,
		db,
		locators,
		owned,
		userId: USER_ID,
		watched,
	});

describe("persistProgressAndStatus", () => {
	it("writes progress and derived status in one batch", async () => {
		const db = await seedUser();
		await persist(db, [OWNED[0]], true);
		expect(await db.select().from(watchStatus).all()).toEqual([
			expect.objectContaining({
				continuityKey: CONTINUITY_ID,
				status: "watching",
				userId: USER_ID,
			}),
		]);
		await persist(db, [OWNED[1]], true);
		expect(await db.select().from(watchStatus).all()).toEqual([
			expect.objectContaining({ status: "completed" }),
		]);
		expect(await db.select().from(episodeProgress).all()).toHaveLength(2);
	});

	it("keeps rewatch count when upserting derived status", async () => {
		const db = await seedUser();
		await db
			.insert(watchStatus)
			.values({
				continuityKey: CONTINUITY_ID,
				rewatchCount: 3,
				status: "watching",
				userId: USER_ID,
			})
			.run();
		await persist(db, OWNED, true);
		expect(await db.select().from(watchStatus).all()).toEqual([
			expect.objectContaining({
				rewatchCount: 3,
				status: "completed",
			}),
		]);
	});

	it("reuses the existing watch_status row when locking the continuity", async () => {
		const db = await seedUser();
		await db
			.insert(watchStatus)
			.values({
				continuityKey: CONTINUITY_ID,
				status: "dropped",
				userId: USER_ID,
			})
			.run();
		await persist(db, [OWNED[0]], true);
		expect(await db.select().from(watchStatus).all()).toEqual([
			expect.objectContaining({
				continuityKey: CONTINUITY_ID,
				status: "watching",
				userId: USER_ID,
			}),
		]);
	});

	it("moves plan_to_watch to watching on the first watched episode", async () => {
		const db = await seedUser();
		await db
			.insert(watchStatus)
			.values({
				continuityKey: CONTINUITY_ID,
				status: "plan_to_watch",
				userId: USER_ID,
			})
			.run();
		await persist(db, [OWNED[0]], true);
		expect(await db.select().from(watchStatus).all()).toEqual([
			expect.objectContaining({
				continuityKey: CONTINUITY_ID,
				status: "watching",
				userId: USER_ID,
			}),
		]);
	});

	it("completes when concurrent part writes cover every locator", async () => {
		const db = await seedUser();
		await Promise.all([
			persist(db, [OWNED[0]], true),
			persist(db, [OWNED[1]], true),
		]);
		expect(await db.select().from(watchStatus).all()).toEqual([
			expect.objectContaining({ status: "completed" }),
		]);
		expect(await db.select().from(episodeProgress).all()).toHaveLength(2);
	});

	it("writes more locators than a 100-bind insert allows", async () => {
		const db = await seedUser();
		const locators = locatorsOf(INSERT_OVER_BIND_LIMIT);
		await persist(db, locators, true, locators);
		expect(await db.select().from(episodeProgress).all()).toHaveLength(
			INSERT_OVER_BIND_LIMIT,
		);
		expect(await db.select().from(watchStatus).all()).toEqual([
			expect.objectContaining({ status: "completed" }),
		]);
	});

	it("derives status for more owned locators than a 100-bind IN list allows", async () => {
		const db = await seedUser();
		const owned = locatorsOf(OWNED_OVER_BIND_LIMIT);
		await persist(db, owned, true, owned);
		expect(await db.select().from(episodeProgress).all()).toHaveLength(
			OWNED_OVER_BIND_LIMIT,
		);
		expect(await db.select().from(watchStatus).all()).toEqual([
			expect.objectContaining({ status: "completed" }),
		]);
		await persist(db, owned.slice(0, 1), false, owned);
		expect(await db.select().from(episodeProgress).all()).toHaveLength(
			OWNED_OVER_BIND_LIMIT - 1,
		);
		expect(await db.select().from(watchStatus).all()).toEqual([
			expect.objectContaining({ status: "watching" }),
		]);
	});
});
