import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
	contentUnits,
	instalmentAssertions,
	pendingGroupCandidates,
	serviceCoverages,
	serviceInstalments,
	serviceTitles,
	titleGroupAliases,
	titleGroups,
} from "@/db/engine-schema";
import type { GroupSource } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import {
	coverageStateFor,
	groupCoverageKey,
	seedPendingCoverage,
} from "@/engine/overflow/coverage.ts";
import { recomputeGroup } from "@/engine/recompute";

import {
	commitMerge,
	convergeGroups,
	planConverge,
	readConvergeState,
	readRevalidationMembers,
} from "./converge.ts";

type Db = Awaited<ReturnType<typeof freshDb>>;

const one = <Row>(rows: readonly Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected an inserted row");
	}
	return row;
};

const seedGroup = async (db: Db, source: GroupSource = "t1-structure") =>
	one(await db.insert(titleGroups).values({ source }).returning().all());

const seedTitle = async (
	db: Db,
	groupId: number,
	service: string,
	serviceId: string,
	ordinal = 0,
) =>
	one(
		await db
			.insert(serviceTitles)
			.values({ groupId, ordinal, service, serviceId })
			.returning()
			.all(),
	);

const seedSpoke = async (db: Db, titleId: number, locator: string) =>
	one(
		await db
			.insert(serviceInstalments)
			.values({ locator, locatorKind: "position", titleId })
			.returning()
			.all(),
	).id;

const curatedLink = async (db: Db, leftSpoke: number, rightSpoke: number) => {
	const created = one(
		await db.insert(contentUnits).values({}).returning().all(),
	);
	await db
		.insert(instalmentAssertions)
		.values(
			[leftSpoke, rightSpoke].map((instalmentId) => ({
				confidence: "high" as const,
				instalmentId,
				source: "manual" as const,
				unitId: created.id,
			})),
		)
		.run();
};

const memberIdsOf = async (
	db: Db,
	groupId: number,
): Promise<readonly number[]> => {
	const rows = await db
		.select({ id: serviceTitles.id })
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, groupId))
		.all();
	return rows.map((row) => row.id).toSorted((left, right) => left - right);
};

const aliasOf = async (db: Db, retiredGroupId: number) =>
	db
		.select()
		.from(titleGroupAliases)
		.where(eq(titleGroupAliases.retiredGroupId, retiredGroupId))
		.all();

describe("converge with stored groups", () => {
	let db: Db;

	beforeEach(async () => {
		db = await freshDb();
	});

	it("merges two overlapping algorithmic groups onto the lowest id, aliasing the loser", async () => {
		const survivor = await seedGroup(db);
		const loser = await seedGroup(db);
		const titleA = await seedTitle(db, survivor.id, "tmdb", "1", 0);
		const titleB = await seedTitle(db, loser.id, "imdb", "tt2", 0);

		const outcome = await convergeGroups(db, {
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
		const survivorMembers = await memberIdsOf(db, survivor.id);
		expect(survivorMembers.toSorted((left, right) => left - right)).toEqual(
			[titleA.id, titleB.id].toSorted((left, right) => left - right),
		);
		expect(await memberIdsOf(db, loser.id)).toEqual([]);
		const orderedTitles = await db
			.select()
			.from(serviceTitles)
			.orderBy(serviceTitles.ordinal)
			.all();
		const ordinals = orderedTitles.map((row) => ({
			ordinal: row.ordinal,
			titleId: row.id,
		}));
		expect(ordinals).toEqual([
			{ ordinal: 0, titleId: titleA.id },
			{ ordinal: 1, titleId: titleB.id },
		]);
		// The emptied loser survives and its id resolves one hop to the survivor.
		expect(
			await db
				.select()
				.from(titleGroups)
				.where(eq(titleGroups.id, loser.id))
				.all(),
		).toHaveLength(1);
		expect(await aliasOf(db, loser.id)).toEqual([
			expect.objectContaining({
				retiredGroupId: loser.id,
				survivorGroupId: survivor.id,
			}),
		]);
	});

	it("rebuilds service coverages under the survivor after a merge", async () => {
		const survivor = await seedGroup(db);
		const loser = await seedGroup(db);
		await seedTitle(db, survivor.id, "tmdb", "1", 0);
		await seedTitle(db, loser.id, "imdb", "tt2", 0);
		const survivorKey = groupCoverageKey(survivor.id);
		const retiredKey = groupCoverageKey(loser.id);
		await seedPendingCoverage(db, survivorKey, 1, "tmdb");
		await seedPendingCoverage(db, retiredKey, 1, "tmdb");

		const outcome = await convergeGroups(db, {
			members: [
				{ ordinal: 0, service: "tmdb", serviceId: "1" },
				{ ordinal: 1, service: "imdb", serviceId: "tt2" },
			],
		});

		expect(outcome.kind).toBe("merged");
		const coverageRows = await db.select().from(serviceCoverages).all();
		expect(
			coverageRows.filter((row) => row.baselineContinuity === retiredKey),
		).toHaveLength(0);
		expect(await coverageStateFor(db, survivorKey, 2, "tmdb")).toBe("pending");
	});

	it("flattens an existing alias chain onto the new survivor", async () => {
		const survivor = await seedGroup(db);
		const loser = await seedGroup(db);
		const older = await seedGroup(db);
		await seedTitle(db, survivor.id, "tmdb", "1", 0);
		await seedTitle(db, loser.id, "imdb", "tt2", 0);
		// `older` was already retired into `loser`; retiring `loser` must re-point it.
		await db
			.insert(titleGroupAliases)
			.values({ retiredGroupId: older.id, survivorGroupId: loser.id })
			.run();

		await convergeGroups(db, {
			members: [
				{ ordinal: 0, service: "tmdb", serviceId: "1" },
				{ ordinal: 1, service: "imdb", serviceId: "tt2" },
			],
		});

		expect(await aliasOf(db, older.id)).toEqual([
			expect.objectContaining({ survivorGroupId: survivor.id }),
		]);
	});

	it("lands nothing when a concurrent converge got there first", async () => {
		const survivor = await seedGroup(db);
		const loser = await seedGroup(db);
		await seedTitle(db, survivor.id, "tmdb", "1", 0);
		await seedTitle(db, loser.id, "imdb", "tt2", 0);
		const input = {
			members: [
				{ ordinal: 0, service: "tmdb", serviceId: "1" },
				{ ordinal: 1, service: "imdb", serviceId: "tt2" },
			],
		};
		// Two plans off the same read; the first wins.
		const state = await readConvergeState(db, input);
		const first = planConverge(input, state);
		const second = planConverge(input, state);
		if (first.kind !== "merge" || second.kind !== "merge") {
			throw new Error("expected two merge plans");
		}

		const merged = await convergeGroups(db, input);
		expect(merged.kind).toBe("merged");
		// Re-committing the stale second plan sees moved membership and aborts untouched.
		const aborted = await commitMerge(db, second);
		expect(aborted.kind).toBe("aborted");
		expect(await memberIdsOf(db, survivor.id)).toHaveLength(2);
		expect(await aliasOf(db, loser.id)).toHaveLength(1);
	});

	it("queues a candidate and touches nothing when a group is curated", async () => {
		const survivor = await seedGroup(db);
		const curated = await seedGroup(db);
		const titleA = await seedTitle(db, survivor.id, "tmdb", "1", 0);
		const titleB = await seedTitle(db, curated.id, "imdb", "tt2", 0);
		const spokeA = await seedSpoke(db, titleA.id, "1:1");
		const spokeB = await seedSpoke(db, titleB.id, "1:1");
		await curatedLink(db, spokeA, spokeB);

		const outcome = await convergeGroups(db, {
			members: [
				{ ordinal: 0, service: "tmdb", serviceId: "1" },
				{ ordinal: 1, service: "imdb", serviceId: "tt2" },
			],
		});

		expect(outcome.kind).toBe("candidate");
		const candidates = await db.select().from(pendingGroupCandidates).all();
		expect(candidates).toHaveLength(1);
		expect(candidates[0]?.kind).toBe("structural");
		expect(candidates[0]?.evidence).toEqual({
			competingGroupIds: [survivor.id, curated.id].toSorted(
				(left, right) => left - right,
			),
			kind: "structural",
			proposedMembers: [
				{ service: "imdb", serviceId: "tt2" },
				{ service: "tmdb", serviceId: "1" },
			],
		});
		// Both groups keep their exact membership; nothing is aliased.
		expect(await memberIdsOf(db, survivor.id)).toEqual([titleA.id]);
		expect(await memberIdsOf(db, curated.id)).toEqual([titleB.id]);
		expect(await db.select().from(titleGroupAliases).all()).toEqual([]);
	});

	it("coalesces a repeat curated collision onto one open candidate", async () => {
		const survivor = await seedGroup(db);
		const curated = await seedGroup(db, "manual");
		await seedTitle(db, survivor.id, "tmdb", "1", 0);
		await seedTitle(db, curated.id, "imdb", "tt2", 0);
		const input = {
			members: [
				{ ordinal: 0, service: "tmdb", serviceId: "1" },
				{ ordinal: 1, service: "imdb", serviceId: "tt2" },
			],
		};

		const first = await convergeGroups(db, input);
		expect(first.kind).toBe("candidate");
		expect(await convergeGroups(db, input)).toEqual({
			candidateId: undefined,
			kind: "candidate",
		});
		expect(await db.select().from(pendingGroupCandidates).all()).toHaveLength(
			1,
		);
	});

	it("queues a candidate when a group holds a member the discovery never named", async () => {
		const survivor = await seedGroup(db);
		const wider = await seedGroup(db);
		await seedTitle(db, survivor.id, "tmdb", "1", 0);
		await seedTitle(db, wider.id, "imdb", "tt2", 0);
		// `wider` also holds a title the discovery says nothing about.
		await seedTitle(db, wider.id, "anidb", "9", 1);

		const outcome = await convergeGroups(db, {
			members: [
				{ ordinal: 0, service: "tmdb", serviceId: "1" },
				{ ordinal: 1, service: "imdb", serviceId: "tt2" },
			],
		});

		expect(outcome.kind).toBe("candidate");
		expect(await db.select().from(pendingGroupCandidates).all()).toHaveLength(
			1,
		);
		expect(await memberIdsOf(db, wider.id)).toHaveLength(2);
	});

	it("does nothing when the discovery is already contained in one group", async () => {
		const group = await seedGroup(db);
		await seedTitle(db, group.id, "tmdb", "1", 0);
		await seedTitle(db, group.id, "imdb", "tt2", 1);

		const outcome = await convergeGroups(db, {
			members: [
				{ ordinal: 0, service: "tmdb", serviceId: "1" },
				{ ordinal: 1, service: "imdb", serviceId: "tt2" },
			],
		});

		expect(outcome).toEqual({ kind: "no-op" });
		expect(await db.select().from(titleGroupAliases).all()).toEqual([]);
	});

	it("does nothing when the discovery agrees with a single curated group", async () => {
		// Machine evidence that lands exactly on a human's grouping is agreement, not
		// a collision — it must not re-raise a candidate on every rediscovery.
		const group = await seedGroup(db, "manual");
		await seedTitle(db, group.id, "tmdb", "1", 0);
		await seedTitle(db, group.id, "imdb", "tt2", 1);

		const outcome = await convergeGroups(db, {
			members: [
				{ ordinal: 0, service: "tmdb", serviceId: "1" },
				{ ordinal: 1, service: "imdb", serviceId: "tt2" },
			],
		});

		expect(outcome).toEqual({ kind: "no-op" });
		expect(await db.select().from(pendingGroupCandidates).all()).toEqual([]);
	});

	it("does nothing when no named member is stored", async () => {
		const outcome = await convergeGroups(db, {
			members: [{ ordinal: 0, service: "tmdb", serviceId: "404" }],
		});
		expect(outcome).toEqual({ kind: "no-op" });
	});

	it("revalidates against exactly the stored membership in stored ordinal order", async () => {
		const group = await seedGroup(db);
		const titleA = await seedTitle(db, group.id, "tmdb", "1", 0);
		const titleB = await seedTitle(db, group.id, "imdb", "tt2", 1);
		const titleC = await seedTitle(db, group.id, "anidb", "9", 2);
		const spokeA = await seedSpoke(db, titleA.id, "1:1");
		const spokeB = await seedSpoke(db, titleB.id, "1:1");
		await seedSpoke(db, titleC.id, "1:1");

		const members = await readRevalidationMembers(db, group.id);
		// Exactly the stored membership, in stored ordinal order — never rediscovered.
		expect(members.map((member) => member.titleId)).toEqual([
			titleA.id,
			titleB.id,
			titleC.id,
		]);

		// Remapping drives off that membership alone: pair the first two members'
		// spokes without consulting any find client.
		const outcome = await recomputeGroup(db, {
			groupId: group.id,
			ladderComplete: true,
			pairings: [
				{
					confidence: "high",
					source: "t3-episode",
					spokeIds: [spokeA, spokeB],
				},
			],
			triedSource: "t3-episode",
		});

		expect(outcome.kind).toBe("applied");
		// The membership is unchanged: no member was narrowed away by the remap.
		expect(await memberIdsOf(db, group.id)).toEqual(
			[titleA.id, titleB.id, titleC.id].toSorted((left, right) => left - right),
		);
	});

	it("keeps every member when an index hiccup duplicates an ordinal", async () => {
		const group = await seedGroup(db);
		const titleA = await seedTitle(db, group.id, "tmdb", "1", 0);
		const titleB = await seedTitle(db, group.id, "imdb", "tt2", 0);
		const titleC = await seedTitle(db, group.id, "anidb", "9", 0);

		const members = await readRevalidationMembers(db, group.id);
		// A shared ordinal breaks the tie by id, but narrows nothing.
		expect(
			members
				.map((member) => member.titleId)
				.toSorted((left, right) => left - right),
		).toEqual(
			[titleA.id, titleB.id, titleC.id].toSorted((left, right) => left - right),
		);
		expect(members).toHaveLength(3);
	});
});
