import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
	contentUnits,
	instalmentAssertions,
	pendingGroupCandidates,
	serviceInstalments,
	serviceTitles,
	titleGroupAliases,
	titleGroups,
} from "@/db/engine-schema";
import type { GroupSource } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import { recomputeGroup } from "@/engine/recompute";

import {
	commitMerge,
	convergeGroups,
	planConverge,
	readConvergeState,
	readRevalidationMembers,
} from "./converge.ts";

type Db = ReturnType<typeof freshDb>;

const one = <Row>(rows: readonly Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected an inserted row");
	}
	return row;
};

const seedGroup = (db: Db, source: GroupSource = "t1-structure") =>
	one(db.insert(titleGroups).values({ source }).returning().all());

const seedTitle = (
	db: Db,
	groupId: number,
	service: string,
	serviceId: string,
	ordinal = 0,
) =>
	one(
		db
			.insert(serviceTitles)
			.values({ groupId, ordinal, service, serviceId })
			.returning()
			.all(),
	);

const seedSpoke = (db: Db, titleId: number, locator: string) =>
	one(
		db
			.insert(serviceInstalments)
			.values({ locator, locatorKind: "position", titleId })
			.returning()
			.all(),
	).id;

const curatedLink = (db: Db, leftSpoke: number, rightSpoke: number) => {
	const unitId = one(db.insert(contentUnits).values({}).returning().all()).id;
	for (const spokeId of [leftSpoke, rightSpoke]) {
		db.insert(instalmentAssertions)
			.values({ confidence: "high", instalmentId: spokeId, source: "manual", unitId })
			.run();
	}
};

const memberIdsOf = (db: Db, groupId: number): readonly number[] =>
	db
		.select({ id: serviceTitles.id })
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, groupId))
		.all()
		.map((row) => row.id)
		.toSorted((left, right) => left - right);

const aliasOf = (db: Db, retiredGroupId: number) =>
	db
		.select()
		.from(titleGroupAliases)
		.where(eq(titleGroupAliases.retiredGroupId, retiredGroupId))
		.all();

describe("converge with stored groups", () => {
	let db: Db;

	beforeEach(() => {
		db = freshDb();
	});

	it("merges two overlapping algorithmic groups onto the lowest id, aliasing the loser", () => {
		const survivor = seedGroup(db);
		const loser = seedGroup(db);
		const titleA = seedTitle(db, survivor.id, "tmdb", "1", 0);
		const titleB = seedTitle(db, loser.id, "imdb", "tt2", 0);

		const outcome = convergeGroups(db, {
			members: [
				{ ordinal: 0, service: "tmdb", serviceId: "1" },
				{ ordinal: 1, service: "imdb", serviceId: "tt2" },
			],
		});

		expect(outcome).toEqual({
			kind: "merged",
			retiredIds: [loser.id],
			survivorId: survivor.id,
		});
		// Every member now lives under the survivor, densely re-ranked in discovery order.
		expect(memberIdsOf(db, survivor.id).toSorted((left, right) => left - right)).toEqual(
			[titleA.id, titleB.id].toSorted((left, right) => left - right),
		);
		expect(memberIdsOf(db, loser.id)).toEqual([]);
		const ordinals = db
			.select()
			.from(serviceTitles)
			.orderBy(serviceTitles.ordinal)
			.all()
			.map((row) => ({ ordinal: row.ordinal, titleId: row.id }));
		expect(ordinals).toEqual([
			{ ordinal: 0, titleId: titleA.id },
			{ ordinal: 1, titleId: titleB.id },
		]);
		// The emptied loser survives and its id resolves one hop to the survivor.
		expect(db.select().from(titleGroups).where(eq(titleGroups.id, loser.id)).all()).toHaveLength(1);
		expect(aliasOf(db, loser.id)).toEqual([
			expect.objectContaining({ retiredGroupId: loser.id, survivorGroupId: survivor.id }),
		]);
	});

	it("flattens an existing alias chain onto the new survivor", () => {
		const survivor = seedGroup(db);
		const loser = seedGroup(db);
		const older = seedGroup(db);
		seedTitle(db, survivor.id, "tmdb", "1", 0);
		seedTitle(db, loser.id, "imdb", "tt2", 0);
		// `older` was already retired into `loser`; retiring `loser` must re-point it.
		db.insert(titleGroupAliases)
			.values({ retiredGroupId: older.id, survivorGroupId: loser.id })
			.run();

		convergeGroups(db, {
			members: [
				{ ordinal: 0, service: "tmdb", serviceId: "1" },
				{ ordinal: 1, service: "imdb", serviceId: "tt2" },
			],
		});

		expect(aliasOf(db, older.id)).toEqual([
			expect.objectContaining({ survivorGroupId: survivor.id }),
		]);
	});

	it("lands nothing when a concurrent converge got there first", () => {
		const survivor = seedGroup(db);
		const loser = seedGroup(db);
		seedTitle(db, survivor.id, "tmdb", "1", 0);
		seedTitle(db, loser.id, "imdb", "tt2", 0);
		const input = {
			members: [
				{ ordinal: 0, service: "tmdb", serviceId: "1" },
				{ ordinal: 1, service: "imdb", serviceId: "tt2" },
			],
		};
		// Two plans off the same read; the first wins.
		const state = readConvergeState(db, input);
		const first = planConverge(input, state);
		const second = planConverge(input, state);
		if (first.kind !== "merge" || second.kind !== "merge") {
			throw new Error("expected two merge plans");
		}

		expect(convergeGroups(db, input).kind).toBe("merged");
		// Re-committing the stale second plan sees moved membership and aborts untouched.
		expect(commitMerge(db, second).kind).toBe("aborted");
		expect(memberIdsOf(db, survivor.id)).toHaveLength(2);
		expect(aliasOf(db, loser.id)).toHaveLength(1);
	});

	it("queues a candidate and touches nothing when a group is curated", () => {
		const survivor = seedGroup(db);
		const curated = seedGroup(db);
		const titleA = seedTitle(db, survivor.id, "tmdb", "1", 0);
		const titleB = seedTitle(db, curated.id, "imdb", "tt2", 0);
		const spokeA = seedSpoke(db, titleA.id, "1:1");
		const spokeB = seedSpoke(db, titleB.id, "1:1");
		curatedLink(db, spokeA, spokeB);

		const outcome = convergeGroups(db, {
			members: [
				{ ordinal: 0, service: "tmdb", serviceId: "1" },
				{ ordinal: 1, service: "imdb", serviceId: "tt2" },
			],
		});

		expect(outcome.kind).toBe("candidate");
		const candidates = db.select().from(pendingGroupCandidates).all();
		expect(candidates).toHaveLength(1);
		expect(candidates[0]?.kind).toBe("structural");
		expect(candidates[0]?.evidence).toEqual({
			competingGroupIds: [survivor.id, curated.id].toSorted((left, right) => left - right),
			kind: "structural",
			proposedMembers: [
				{ service: "imdb", serviceId: "tt2" },
				{ service: "tmdb", serviceId: "1" },
			],
		});
		// Both groups keep their exact membership; nothing is aliased.
		expect(memberIdsOf(db, survivor.id)).toEqual([titleA.id]);
		expect(memberIdsOf(db, curated.id)).toEqual([titleB.id]);
		expect(db.select().from(titleGroupAliases).all()).toEqual([]);
	});

	it("coalesces a repeat curated collision onto one open candidate", () => {
		const survivor = seedGroup(db);
		const curated = seedGroup(db, "manual");
		seedTitle(db, survivor.id, "tmdb", "1", 0);
		seedTitle(db, curated.id, "imdb", "tt2", 0);
		const input = {
			members: [
				{ ordinal: 0, service: "tmdb", serviceId: "1" },
				{ ordinal: 1, service: "imdb", serviceId: "tt2" },
			],
		};

		expect(convergeGroups(db, input).kind).toBe("candidate");
		expect(convergeGroups(db, input)).toEqual({ candidateId: undefined, kind: "candidate" });
		expect(db.select().from(pendingGroupCandidates).all()).toHaveLength(1);
	});

	it("queues a candidate when a group holds a member the discovery never named", () => {
		const survivor = seedGroup(db);
		const wider = seedGroup(db);
		seedTitle(db, survivor.id, "tmdb", "1", 0);
		seedTitle(db, wider.id, "imdb", "tt2", 0);
		// `wider` also holds a title the discovery says nothing about.
		seedTitle(db, wider.id, "anidb", "9", 1);

		const outcome = convergeGroups(db, {
			members: [
				{ ordinal: 0, service: "tmdb", serviceId: "1" },
				{ ordinal: 1, service: "imdb", serviceId: "tt2" },
			],
		});

		expect(outcome.kind).toBe("candidate");
		expect(db.select().from(pendingGroupCandidates).all()).toHaveLength(1);
		expect(memberIdsOf(db, wider.id)).toHaveLength(2);
	});

	it("does nothing when the discovery is already contained in one group", () => {
		const group = seedGroup(db);
		seedTitle(db, group.id, "tmdb", "1", 0);
		seedTitle(db, group.id, "imdb", "tt2", 1);

		const outcome = convergeGroups(db, {
			members: [
				{ ordinal: 0, service: "tmdb", serviceId: "1" },
				{ ordinal: 1, service: "imdb", serviceId: "tt2" },
			],
		});

		expect(outcome).toEqual({ kind: "no-op" });
		expect(db.select().from(titleGroupAliases).all()).toEqual([]);
	});

	it("does nothing when no named member is stored", () => {
		const outcome = convergeGroups(db, {
			members: [{ ordinal: 0, service: "tmdb", serviceId: "404" }],
		});
		expect(outcome).toEqual({ kind: "no-op" });
	});

	it("revalidates against exactly the stored membership in stored ordinal order", () => {
		const group = seedGroup(db);
		const titleA = seedTitle(db, group.id, "tmdb", "1", 0);
		const titleB = seedTitle(db, group.id, "imdb", "tt2", 1);
		const titleC = seedTitle(db, group.id, "anidb", "9", 2);
		const spokeA = seedSpoke(db, titleA.id, "1:1");
		const spokeB = seedSpoke(db, titleB.id, "1:1");
		seedSpoke(db, titleC.id, "1:1");

		const members = readRevalidationMembers(db, group.id);
		// Exactly the stored membership, in stored ordinal order — never rediscovered.
		expect(members.map((member) => member.titleId)).toEqual([
			titleA.id,
			titleB.id,
			titleC.id,
		]);

		// Remapping drives off that membership alone: pair the first two members'
		// spokes without consulting any find client.
		const outcome = recomputeGroup(db, {
			groupId: group.id,
			ladderComplete: true,
			pairings: [
				{ confidence: "high", source: "t3-episode", spokeIds: [spokeA, spokeB] },
			],
			triedSource: "t3-episode",
		});

		expect(outcome.kind).toBe("applied");
		// The membership is unchanged: no member was narrowed away by the remap.
		expect(memberIdsOf(db, group.id)).toEqual(
			[titleA.id, titleB.id, titleC.id].toSorted((left, right) => left - right),
		);
	});

	it("keeps every member when an index hiccup duplicates an ordinal", () => {
		const group = seedGroup(db);
		const titleA = seedTitle(db, group.id, "tmdb", "1", 0);
		const titleB = seedTitle(db, group.id, "imdb", "tt2", 0);
		const titleC = seedTitle(db, group.id, "anidb", "9", 0);

		const members = readRevalidationMembers(db, group.id);
		// A shared ordinal breaks the tie by id, but narrows nothing.
		expect(members.map((member) => member.titleId).toSorted((left, right) => left - right)).toEqual(
			[titleA.id, titleB.id, titleC.id].toSorted((left, right) => left - right),
		);
		expect(members).toHaveLength(3);
	});
});
