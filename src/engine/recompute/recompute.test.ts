import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
	absenceAssertions,
	contentUnits,
	instalmentAssertions,
	serviceInstalments,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import type { AssertionSource, GroupSource } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";

import {
	commitRecompute,
	planRecompute,
	readGroupState,
	recomputeGroup,
} from "./recompute.ts";

type Db = Awaited<ReturnType<typeof freshDb>>;

const one = <Row>(rows: readonly Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected an inserted row");
	}
	return row;
};

const seedGroup = async (db: Db, source: GroupSource = "t1-structure", ladderComplete = false) =>
	one(await db.insert(titleGroups).values({ ladderComplete, source }).returning().all());

const seedTitle = async (db: Db, groupId: number, service: string, serviceId: string) =>
	one(await db.insert(serviceTitles).values({ groupId, service, serviceId }).returning().all());

const seedSpoke = async (db: Db, titleId: number, locator: string) =>
	one(
		await db
			.insert(serviceInstalments)
			.values({ locator, locatorKind: "position", titleId })
			.returning()
			.all(),
	).id;

const seedUnit = async (db: Db) =>
	one(await db.insert(contentUnits).values({}).returning().all()).id;

const cover = async (db: Db, instalmentId: number, unitId: number, source: AssertionSource) => {
	await db
		.insert(instalmentAssertions)
		.values({ confidence: "high", instalmentId, source, unitId })
		.run();
};

// A curated link pairs two spokes on one shared unit, both stamped by curation.
const curatedLink = async (db: Db, leftSpoke: number, rightSpoke: number): Promise<number> => {
	const unitId = await seedUnit(db);
	await cover(db, leftSpoke, unitId, "manual");
	await cover(db, rightSpoke, unitId, "manual");
	return unitId;
};

// A curated no-counterpart: the spoke covers a unit that has no counterpart in the
// target service, both the coverage and the absence stamped by curation.
const curatedNoCounterpart = async (
	db: Db,
	spokeId: number,
	targetService: string,
): Promise<number> => {
	const unitId = await seedUnit(db);
	await cover(db, spokeId, unitId, "manual");
	await db
		.insert(absenceAssertions)
		.values({ coverageRevision: 1, source: "manual", targetService, unitId })
		.run();
	return unitId;
};

const assertionsForSpoke = async (db: Db, instalmentId: number) =>
	db
		.select()
		.from(instalmentAssertions)
		.where(eq(instalmentAssertions.instalmentId, instalmentId))
		.all();

describe("curated-preserving recompute", () => {
	let db: Db;

	beforeEach(async () => {
		db = await freshDb();
	});

	it("keeps a curated link and its no-counterpart spoke while re-deriving the rest", async () => {
		const group = await seedGroup(db);
		const titleA = await seedTitle(db, group.id, "tmdb", "603");
		const titleB = await seedTitle(db, group.id, "imdb", "tt0133093");
		const a1 = await seedSpoke(db, titleA.id, "1:1");
		const a2 = await seedSpoke(db, titleA.id, "1:2");
		const a3 = await seedSpoke(db, titleA.id, "1:3");
		const b1 = await seedSpoke(db, titleB.id, "1:1");
		const b2 = await seedSpoke(db, titleB.id, "1:2");
		const curatedUnit = await curatedLink(db, a1, b1);
		const absentUnit = await curatedNoCounterpart(db, a2, "imdb");
		// A stale algorithmic pairing that a recompute should replace.
		const staleUnit = await seedUnit(db);
		await cover(db, a3, staleUnit, "t3-episode");
		await cover(db, b2, staleUnit, "t3-episode");

		const outcome = await recomputeGroup(db, {
			groupId: group.id,
			ladderComplete: true,
			pairings: [{ confidence: "high", source: "t3-episode", spokeIds: [a3, b2] }],
			triedSource: "t3-episode",
		});

		expect(outcome.kind).toBe("applied");
		// The curated link survives untouched.
		expect(await assertionsForSpoke(db, a1)).toEqual([
			expect.objectContaining({ source: "manual", unitId: curatedUnit }),
		]);
		expect(await assertionsForSpoke(db, b1)).toEqual([
			expect.objectContaining({ source: "manual", unitId: curatedUnit }),
		]);
		// The no-counterpart spoke and its absence survive.
		expect(await assertionsForSpoke(db, a2)).toEqual([
			expect.objectContaining({ source: "manual", unitId: absentUnit }),
		]);
		expect(await db.select().from(absenceAssertions).all()).toHaveLength(1);
		// The stale pairing is re-derived onto a fresh unit, off the retired one.
		const rederivedA3 = await assertionsForSpoke(db, a3);
		const rederivedB2 = await assertionsForSpoke(db, b2);
		expect(rederivedA3).toHaveLength(1);
		expect(rederivedB2).toHaveLength(1);
		expect(rederivedA3[0]?.source).toBe("t3-episode");
		expect(rederivedA3[0]?.unitId).not.toBe(staleUnit);
		expect(rederivedA3[0]?.unitId).toBe(rederivedB2[0]?.unitId);
		expect(
			await db
				.select()
				.from(instalmentAssertions)
				.where(eq(instalmentAssertions.unitId, staleUnit))
				.all(),
		).toHaveLength(0);
	});

	it("drops a pairing that collides with a curated position, leaving the surviving spoke unlinked", async () => {
		const group = await seedGroup(db);
		const titleA = await seedTitle(db, group.id, "tmdb", "603");
		const titleB = await seedTitle(db, group.id, "imdb", "tt0133093");
		const a1 = await seedSpoke(db, titleA.id, "1:1");
		const b1 = await seedSpoke(db, titleB.id, "1:1");
		const b2 = await seedSpoke(db, titleB.id, "1:2");
		await curatedLink(db, a1, b1);
		// The fresh matcher wants a1, which curation already holds.
		const colliding = { confidence: "high", source: "t3-episode", spokeIds: [a1, b2] } as const;

		const state = await readGroupState(db, group.id);
		if (state === undefined) {
			throw new Error("expected a group state");
		}
		const plan = planRecompute(state, {
			groupId: group.id,
			ladderComplete: true,
			pairings: [colliding],
			triedSource: "t3-episode",
		});
		expect(plan.droppedPairings).toEqual([colliding]);
		expect(plan.newUnits).toHaveLength(0);

		const outcome = await commitRecompute(db, plan);
		expect(outcome.kind).toBe("applied");
		// The curated spoke keeps only its curated assertion; the surviving side is
		// unlinked rather than joined to a1.
		expect(await assertionsForSpoke(db, a1)).toEqual([
			expect.objectContaining({ source: "manual" }),
		]);
		expect(await assertionsForSpoke(db, b2)).toHaveLength(0);
	});

	it("aborts the batch when a correction lands in the window", async () => {
		const group = await seedGroup(db);
		const titleA = await seedTitle(db, group.id, "tmdb", "603");
		const titleB = await seedTitle(db, group.id, "imdb", "tt0133093");
		const a1 = await seedSpoke(db, titleA.id, "1:1");
		const b1 = await seedSpoke(db, titleB.id, "1:1");
		const b2 = await seedSpoke(db, titleB.id, "1:2");
		const staleUnit = await seedUnit(db);
		await cover(db, a1, staleUnit, "t3-episode");
		await cover(db, b1, staleUnit, "t3-episode");

		const state = await readGroupState(db, group.id);
		if (state === undefined) {
			throw new Error("expected a group state");
		}
		const plan = planRecompute(state, {
			groupId: group.id,
			ladderComplete: true,
			pairings: [{ confidence: "high", source: "t3-episode", spokeIds: [a1, b1] }],
			triedSource: "t3-episode",
		});

		// A correction is approved before the commit: an admin vouches for b2.
		await curatedNoCounterpart(db, b2, "tmdb");

		const outcome = await commitRecompute(db, plan);

		expect(outcome.kind).toBe("aborted");
		// Nothing the plan would have written or deleted has moved.
		expect(
			await db
				.select()
				.from(instalmentAssertions)
				.where(eq(instalmentAssertions.unitId, staleUnit))
				.all(),
		).toHaveLength(2);
		expect(await assertionsForSpoke(db, a1)).toEqual([
			expect.objectContaining({ source: "t3-episode", unitId: staleUnit }),
		]);
	});

	it("aborts when a concurrent recompute already re-derived the same links", async () => {
		const group = await seedGroup(db);
		const titleA = await seedTitle(db, group.id, "tmdb", "603");
		const titleB = await seedTitle(db, group.id, "imdb", "tt0133093");
		const a1 = await seedSpoke(db, titleA.id, "1:1");
		const b1 = await seedSpoke(db, titleB.id, "1:1");
		const staleUnit = await seedUnit(db);
		await cover(db, a1, staleUnit, "t3-episode");
		await cover(db, b1, staleUnit, "t3-episode");

		const state = await readGroupState(db, group.id);
		if (state === undefined) {
			throw new Error("expected a group state");
		}
		const input = {
			groupId: group.id,
			ladderComplete: true,
			pairings: [{ confidence: "high", source: "t3-episode", spokeIds: [a1, b1] }],
			triedSource: "t3-episode",
		} as const;
		const plan = planRecompute(state, input);

		// A second recompute with an identical stamp gets there first.
		const winner = await recomputeGroup(db, input);
		expect(winner.kind).toBe("applied");

		// The first plan's commit sees a moved algorithmic set and lands nothing, so
		// the spoke keeps a single coverage unit rather than a duplicate.
		const loser = await commitRecompute(db, plan);
		expect(loser.kind).toBe("aborted");
		expect(await assertionsForSpoke(db, a1)).toHaveLength(1);
	});

	it("preserves the stamp of a vouched group but still re-derives its links", async () => {
		// Vouched and ladder-complete, against an input that disagrees on both, so a
		// stamp written wholesale would flip source and ladder_complete.
		const group = await seedGroup(db, "manual", true);
		const titleA = await seedTitle(db, group.id, "tmdb", "603");
		const titleB = await seedTitle(db, group.id, "imdb", "tt0133093");
		const a1 = await seedSpoke(db, titleA.id, "1:1");
		const b1 = await seedSpoke(db, titleB.id, "1:1");
		const staleUnit = await seedUnit(db);
		await cover(db, a1, staleUnit, "t3-episode");
		await cover(db, b1, staleUnit, "t3-episode");

		const state = await readGroupState(db, group.id);
		if (state === undefined) {
			throw new Error("expected a group state");
		}
		const plan = planRecompute(state, {
			groupId: group.id,
			ladderComplete: false,
			pairings: [{ confidence: "high", source: "t3-episode", spokeIds: [a1, b1] }],
			triedSource: "t3-episode",
		});
		expect(plan.stamp).toBeUndefined();

		const outcome = await commitRecompute(db, plan);
		expect(outcome.kind).toBe("applied");
		const stamped = one(
			await db.select().from(titleGroups).where(eq(titleGroups.id, group.id)).all(),
		);
		expect(stamped.source).toBe("manual");
		expect(stamped.ladderComplete).toBe(true);
		// The links are re-derived onto a fresh unit regardless of the vouch.
		const rederived = await assertionsForSpoke(db, a1);
		expect(rederived).toHaveLength(1);
		expect(rederived[0]?.unitId).not.toBe(staleUnit);
	});
});
