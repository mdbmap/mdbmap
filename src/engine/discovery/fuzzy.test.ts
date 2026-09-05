import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
	pendingGroupCandidates,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import type { GroupSource } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";

import {
	acceptFuzzyCandidate,
	rejectFuzzyCandidate,
	runFuzzyDiscovery,
} from "./fuzzy.ts";
import type {
	FuzzyDiscoveryOutcome,
	FuzzySearchClient,
	FuzzySearchClients,
	FuzzySearchResult,
} from "./fuzzy.ts";

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

// A stub client that answers every search with the same fixed result set: the
// scoring and bucketing are what the tests exercise, not the search itself.
const clientOf = (
	results: readonly FuzzySearchResult[],
): FuzzySearchClient => ({
	search: () => results,
});

const bebop = "Cowboy Bebop";

const candidates = async (db: Db) =>
	db.select().from(pendingGroupCandidates).all();

const groupSource = async (db: Db, groupId: number): Promise<GroupSource> => {
	const row = one(
		await db
			.select()
			.from(titleGroups)
			.where(eq(titleGroups.id, groupId))
			.all(),
	);
	return row.source;
};

const openCandidate = (outcome: FuzzyDiscoveryOutcome): number => {
	if (outcome.kind !== "queued" || outcome.candidateId === undefined) {
		throw new Error(`expected a queued candidate, got ${outcome.kind}`);
	}
	return outcome.candidateId;
};

describe("fuzzy candidates", () => {
	let db: Db;

	beforeEach(async () => {
		db = await freshDb();
	});

	it("queues a fuzzy-group with three buckets and leaves membership unchanged", async () => {
		const group = await seedGroup(db);
		const subject = await seedTitle(db, group.id, "tmdb", "1");
		const clients: FuzzySearchClients = {
			imdb: clientOf([
				{ serviceId: "tt10", title: bebop, year: 1998 },
				{ serviceId: "tt11", title: bebop, year: 1999 },
				{ serviceId: "tt12", title: bebop, year: 1997 },
				// Perfect title, disagreeing year — sinks below the bar on the year alone.
				{ serviceId: "tt13", title: bebop, year: 1980 },
			]),
			// The subject's own service returns the subject, which is filtered as a member.
			tmdb: clientOf([{ serviceId: "1", title: bebop, year: 1998 }]),
		};

		const outcome = await runFuzzyDiscovery(
			db,
			{ clients },
			{
				queries: [
					{ service: "tmdb", title: bebop, year: 1998 },
					{ service: "imdb", title: bebop, year: 1998 },
				],
				subjectTitleId: subject.id,
			},
		);

		expect(outcome.kind).toBe("queued");
		const rows = await candidates(db);
		expect(rows).toHaveLength(1);
		const row = one(rows);
		expect(row.kind).toBe("fuzzy-group");
		expect(row.status).toBe("open");
		if (row.evidence.kind !== "fuzzy-group") {
			throw new Error("expected fuzzy-group evidence");
		}
		// Three cleared hits, member cap 2: two proposed, one over the cap; the
		// disagreeing-year hit dropped to "also considered".
		expect(row.evidence.proposedMembers.map((hit) => hit.serviceId)).toEqual([
			"tt10",
			"tt11",
		]);
		expect(row.evidence.overCap.map((hit) => hit.serviceId)).toEqual(["tt12"]);
		expect(row.evidence.alsoConsidered.map((hit) => hit.serviceId)).toEqual([
			"tt13",
		]);
		expect(row.evidence.queries.map((query) => query.service)).toEqual([
			"tmdb",
			"imdb",
		]);
		// Every stored hit carries its score.
		for (const hit of row.evidence.proposedMembers) {
			expect(hit.score).toBeGreaterThanOrEqual(0.7);
		}

		// The resolve is unchanged: no title joined the group, nothing was written
		// beyond the candidate row.
		expect(await db.select().from(serviceTitles).all()).toHaveLength(1);
		expect(await groupSource(db, group.id)).toBe("t1-structure");
	});

	it("queues nothing when no hit clears the bar", async () => {
		const group = await seedGroup(db);
		const subject = await seedTitle(db, group.id, "tmdb", "1");
		const clients: FuzzySearchClients = {
			imdb: clientOf([{ serviceId: "tt10", title: "Space Dandy", year: 2014 }]),
		};

		const outcome = await runFuzzyDiscovery(
			db,
			{ clients },
			{
				queries: [{ service: "imdb", title: bebop, year: 1998 }],
				subjectTitleId: subject.id,
			},
		);

		expect(outcome.kind).toBe("no-proposal");
		expect(await candidates(db)).toHaveLength(0);
	});

	it("accepts through the curated attach path with stored-first, scored ordinals", async () => {
		const group = await seedGroup(db);
		const subject = await seedTitle(db, group.id, "tmdb", "1");
		const clients: FuzzySearchClients = {
			imdb: clientOf([
				// Lower title similarity, so it scores below the exact match and attaches second.
				{ serviceId: "tt10", title: "Cowboy Bebop: The Movie", year: 1998 },
				{ serviceId: "tt11", title: bebop, year: 1998 },
			]),
		};
		const candidateId = openCandidate(
			await runFuzzyDiscovery(
				db,
				{ clients },
				{
					queries: [{ service: "imdb", title: bebop, year: 1998 }],
					subjectTitleId: subject.id,
				},
			),
		);

		const outcome = await acceptFuzzyCandidate(db, candidateId);

		if (outcome.kind !== "accepted") {
			throw new Error(`expected an accepted outcome, got ${outcome.kind}`);
		}
		expect(outcome.groupId).toBe(group.id);
		expect(outcome.refused).toEqual([]);
		expect(outcome.attachedTitleIds).toHaveLength(2);
		// Stored member keeps ordinal 0; the proposal follows in scored order
		// (the exact match tt11 outscores tt10).
		const orderedRows = await db
			.select()
			.from(serviceTitles)
			.where(eq(serviceTitles.groupId, group.id))
			.orderBy(serviceTitles.ordinal)
			.all();
		const ordered = orderedRows.map((row) => ({
			ordinal: row.ordinal,
			serviceId: row.serviceId,
		}));
		expect(ordered).toEqual([
			{ ordinal: 0, serviceId: "1" },
			{ ordinal: 1, serviceId: "tt11" },
			{ ordinal: 2, serviceId: "tt10" },
		]);
		// The vouch turns the group curated so a later recompute preserves it.
		expect(await groupSource(db, group.id)).toBe("manual");
		expect(one(await candidates(db)).status).toBe("accepted");
	});

	it("refuses a proposed title already stored under another group", async () => {
		const group = await seedGroup(db);
		const subject = await seedTitle(db, group.id, "tmdb", "1");
		const other = await seedGroup(db);
		await seedTitle(db, other.id, "imdb", "tt99");
		const clients: FuzzySearchClients = {
			imdb: clientOf([{ serviceId: "tt99", title: bebop, year: 1998 }]),
		};
		const candidateId = openCandidate(
			await runFuzzyDiscovery(
				db,
				{ clients },
				{
					queries: [{ service: "imdb", title: bebop, year: 1998 }],
					subjectTitleId: subject.id,
				},
			),
		);

		const outcome = await acceptFuzzyCandidate(db, candidateId);

		expect(outcome).toEqual({
			attachedTitleIds: [],
			groupId: group.id,
			kind: "accepted",
			refused: [{ service: "imdb", serviceId: "tt99" }],
		});
		// tt99 stays in its own group; it was refused, not moved.
		const stored = await db
			.select()
			.from(serviceTitles)
			.where(eq(serviceTitles.serviceId, "tt99"))
			.all();
		expect(stored.at(0)?.groupId).toBe(other.id);
	});

	it("queues nothing on a re-proposal after rejection, and reopens on a changed member", async () => {
		const group = await seedGroup(db);
		const subject = await seedTitle(db, group.id, "tmdb", "1");
		const query = {
			queries: [{ service: "imdb", title: bebop, year: 1998 }],
			subjectTitleId: subject.id,
		} as const;
		const twoHits: FuzzySearchClients = {
			imdb: clientOf([
				{ serviceId: "tt10", title: bebop, year: 1998 },
				{ serviceId: "tt11", title: bebop, year: 1998 },
			]),
		};

		const candidateId = openCandidate(
			await runFuzzyDiscovery(db, { clients: twoHits }, query),
		);
		expect(await rejectFuzzyCandidate(db, candidateId)).toEqual({
			candidateId,
			kind: "rejected",
		});

		// The identical proposal finds the rejection and queues nothing.
		const repeat = await runFuzzyDiscovery(db, { clients: twoHits }, query);
		expect(repeat.kind).toBe("suppressed");
		expect(await candidates(db)).toHaveLength(1);

		// Dropping a member hashes differently and reopens the question.
		const oneHit: FuzzySearchClients = {
			imdb: clientOf([{ serviceId: "tt10", title: bebop, year: 1998 }]),
		};
		const reopened = await runFuzzyDiscovery(db, { clients: oneHit }, query);
		expect(reopened.kind).toBe("queued");
		const rows = await candidates(db);
		const statuses = rows
			.map((row) => row.status)
			.toSorted((left, right) => left.localeCompare(right));
		expect(statuses).toEqual(["open", "rejected"]);
	});

	it("coalesces a repeat discovery onto one open row", async () => {
		const group = await seedGroup(db);
		const subject = await seedTitle(db, group.id, "tmdb", "1");
		const clients: FuzzySearchClients = {
			imdb: clientOf([{ serviceId: "tt10", title: bebop, year: 1998 }]),
		};
		const query = {
			queries: [{ service: "imdb", title: bebop, year: 1998 }],
			subjectTitleId: subject.id,
		} as const;

		const first = await runFuzzyDiscovery(db, { clients }, query);
		const second = await runFuzzyDiscovery(db, { clients }, query);

		expect(first.kind).toBe("queued");
		if (second.kind !== "queued") {
			throw new Error(`expected a queued outcome, got ${second.kind}`);
		}
		// The repeat coalesced onto the open row: nothing new was inserted.
		expect(second.candidateId).toBeUndefined();
		expect(second.evidence.kind).toBe("fuzzy-group");
		expect(await candidates(db)).toHaveLength(1);
	});
});
