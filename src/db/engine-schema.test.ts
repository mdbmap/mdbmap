import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import {
	contentUnits,
	instalmentAssertions,
	pendingGroupCandidates,
	relationAssertions,
	serviceInstalments,
	serviceTitles,
	titleAssertions,
	titleGroupAliases,
	titleGroups,
} from "./engine-schema.ts";
import { freshDb } from "./test-helpers.ts";

const one = <Row>(rows: Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected an inserted row");
	}
	return row;
};

const seedGroup = (db: ReturnType<typeof freshDb>) =>
	one(
		db
			.insert(titleGroups)
			.values({ ladderComplete: false, source: "t1-structure" })
			.returning()
			.all(),
	);

const seedTitle = (
	db: ReturnType<typeof freshDb>,
	service: string,
	serviceId: string,
) => {
	const group = seedGroup(db);
	return one(
		db
			.insert(serviceTitles)
			.values({ groupId: group.id, service, serviceId })
			.returning()
			.all(),
	);
};

const seedInstalment = (
	db: ReturnType<typeof freshDb>,
	titleId: number,
	locator: string,
) =>
	one(
		db
			.insert(serviceInstalments)
			.values({ locator, locatorKind: "position", titleId })
			.returning()
			.all(),
	);

const seedUnit = (db: ReturnType<typeof freshDb>) =>
	one(db.insert(contentUnits).values({}).returning().all());

describe("hub-and-spoke coverage edges", () => {
	let db: ReturnType<typeof freshDb>;

	beforeEach(() => {
		db = freshDb();
	});

	it("lets a merged instalment cover two content units", () => {
		const title = seedTitle(db, "tmdb", "1396");
		const instalment = seedInstalment(db, title.id, "s1e12");
		const unitA = seedUnit(db);
		const unitB = seedUnit(db);

		db.insert(instalmentAssertions)
			.values(
				[unitA, unitB].map((unit) => ({
					confidence: "high" as const,
					instalmentId: instalment.id,
					source: "t3-episode" as const,
					unitId: unit.id,
				})),
			)
			.run();

		const rows = db
			.select()
			.from(instalmentAssertions)
			.where(eq(instalmentAssertions.instalmentId, instalment.id))
			.all();
		expect(rows.map((row) => row.unitId).toSorted((left, right) => left - right)).toEqual(
			[unitA.id, unitB.id].toSorted((left, right) => left - right),
		);
	});

	it("lets one content unit be covered by two spokes of a split", () => {
		const title = seedTitle(db, "imdb", "tt0903747");
		const spokeA = seedInstalment(db, title.id, "s1e1");
		const spokeB = seedInstalment(db, title.id, "s1e2");
		const unit = seedUnit(db);

		db.insert(instalmentAssertions)
			.values(
				[spokeA, spokeB].map((spoke) => ({
					confidence: "high" as const,
					instalmentId: spoke.id,
					source: "t3-episode" as const,
					unitId: unit.id,
				})),
			)
			.run();

		const rows = db.select().from(instalmentAssertions).all();
		expect(rows.map((row) => row.instalmentId).toSorted((left, right) => left - right)).toEqual(
			[spokeA.id, spokeB.id].toSorted((left, right) => left - right),
		);
	});

	it("rejects a title overlap edge that is reversed or self-referential", () => {
		const first = seedTitle(db, "tmdb", "first");
		const second = seedTitle(db, "tmdb", "second");
		const [lower, higher] =
			first.id < second.id ? [first, second] : [second, first];

		const insertPair = (titleAId: number, titleBId: number) =>
			db
				.insert(titleAssertions)
				.values({
					confidence: "high",
					source: "t1-structure",
					titleAId,
					titleBId,
				})
				.run();

		expect(() => insertPair(higher.id, lower.id)).toThrow(/constraint/iu);
		expect(() => insertPair(lower.id, lower.id)).toThrow(/constraint/iu);
		expect(() => insertPair(lower.id, higher.id)).not.toThrow();
	});

	it("rejects a second immediate sequel for one title", () => {
		const from = seedTitle(db, "tmdb", "from");
		const sequel = seedTitle(db, "tmdb", "sequel");
		const rival = seedTitle(db, "tmdb", "rival");

		db.insert(relationAssertions)
			.values({
				confidence: "high",
				fromTitleId: from.id,
				source: "llm-verified",
				toTitleId: sequel.id,
			})
			.run();

		expect(() =>
			db
				.insert(relationAssertions)
				.values({
					confidence: "high",
					fromTitleId: from.id,
					source: "llm-verified",
					toTitleId: rival.id,
				})
				.run(),
		).toThrow(/unique/iu);
	});

	it("rejects a relation asserting a title relates to itself", () => {
		const title = seedTitle(db, "tmdb", "self");

		expect(() =>
			db
				.insert(relationAssertions)
				.values({
					confidence: "high",
					fromTitleId: title.id,
					source: "llm-verified",
					toTitleId: title.id,
				})
				.run(),
		).toThrow(/constraint/iu);
	});

	it("rejects a second immediate prequel for one title", () => {
		const to = seedTitle(db, "tmdb", "to");
		const prequel = seedTitle(db, "tmdb", "prequel");
		const rival = seedTitle(db, "tmdb", "rival");

		db.insert(relationAssertions)
			.values({
				confidence: "high",
				fromTitleId: prequel.id,
				source: "llm-verified",
				toTitleId: to.id,
			})
			.run();

		expect(() =>
			db
				.insert(relationAssertions)
				.values({
					confidence: "high",
					fromTitleId: rival.id,
					source: "llm-verified",
					toTitleId: to.id,
				})
				.run(),
		).toThrow(/unique/iu);
	});
});

describe("pending group candidates", () => {
	let db: ReturnType<typeof freshDb>;

	beforeEach(() => {
		db = freshDb();
	});

	it("coalesces a repeat open candidate but reopens on a differing evidence hash", () => {
		const subject = { subjectType: "title" as const, titleId: 1 };
		const evidence = {
			competingGroupIds: [1, 2],
			kind: "structural" as const,
			proposedMembers: [{ service: "tmdb", serviceId: "1396" }],
		};

		db.insert(pendingGroupCandidates)
			.values({ evidence, evidenceHash: "hash-a", kind: "structural", subject })
			.run();

		expect(() =>
			db
				.insert(pendingGroupCandidates)
				.values({
					evidence,
					evidenceHash: "hash-a",
					kind: "structural",
					subject,
				})
				.run(),
		).toThrow(/unique/iu);

		expect(() =>
			db
				.insert(pendingGroupCandidates)
				.values({
					evidence,
					evidenceHash: "hash-b",
					kind: "structural",
					subject,
				})
				.run(),
		).not.toThrow();

		expect(db.select().from(pendingGroupCandidates).all()).toHaveLength(2);
	});

	it("names the title pair as the subject of a title-assertion conflict", () => {
		const subject = {
			subjectType: "title-pair" as const,
			titleAId: 3,
			titleBId: 8,
		};
		const evidence = {
			kind: "title-assertion-conflict" as const,
			proposed: {
				confidence: "high" as const,
				source: "t1-structure" as const,
				titleAId: 3,
				titleBId: 8,
			},
			published: {
				confidence: "low" as const,
				source: "community" as const,
				titleAId: 3,
				titleBId: 8,
			},
		};

		db.insert(pendingGroupCandidates)
			.values({
				evidence,
				evidenceHash: "hash-pair",
				kind: "title-assertion-conflict",
				subject,
			})
			.run();

		const row = one(db.select().from(pendingGroupCandidates).all());
		expect(row.subject).toEqual(subject);
		expect(row.evidence).toEqual(evidence);
	});

	it("lets a resolved candidate coexist with a fresh open row for the same question", () => {
		const subject = { subjectType: "title" as const, titleId: 7 };
		const evidence = {
			competingGroupIds: [],
			kind: "structural" as const,
			proposedMembers: [],
		};

		db.insert(pendingGroupCandidates)
			.values({
				evidence,
				evidenceHash: "hash-c",
				kind: "structural",
				status: "rejected",
				subject,
			})
			.run();

		expect(() =>
			db
				.insert(pendingGroupCandidates)
				.values({
					evidence,
					evidenceHash: "hash-c",
					kind: "structural",
					subject,
				})
				.run(),
		).not.toThrow();
	});
});

describe("title group aliases", () => {
	let db: ReturnType<typeof freshDb>;

	beforeEach(() => {
		db = freshDb();
	});

	it("resolves an alias to its survivor in one hop after a merge", () => {
		const survivor = seedGroup(db);
		const retired = seedGroup(db);

		db.insert(titleGroupAliases)
			.values({ retiredGroupId: retired.id, survivorGroupId: survivor.id })
			.run();

		const alias = one(
			db
				.select()
				.from(titleGroupAliases)
				.where(eq(titleGroupAliases.retiredGroupId, retired.id))
				.all(),
		);
		expect(alias.survivorGroupId).toBe(survivor.id);
	});

	it("flattens a later merge so the original retired id still resolves in one hop", () => {
		const finalSurvivor = seedGroup(db);
		const middle = seedGroup(db);
		const original = seedGroup(db);

		// original merges into middle first.
		db.insert(titleGroupAliases)
			.values({ retiredGroupId: original.id, survivorGroupId: middle.id })
			.run();

		// middle later merges into finalSurvivor; the writer flattens the
		// existing alias instead of leaving an alias-of-alias chain.
		db.update(titleGroupAliases)
			.set({ survivorGroupId: finalSurvivor.id })
			.where(eq(titleGroupAliases.retiredGroupId, original.id))
			.run();
		db.insert(titleGroupAliases)
			.values({
				retiredGroupId: middle.id,
				survivorGroupId: finalSurvivor.id,
			})
			.run();

		const resolved = one(
			db
				.select()
				.from(titleGroupAliases)
				.where(eq(titleGroupAliases.retiredGroupId, original.id))
				.all(),
		);
		expect(resolved.survivorGroupId).toBe(finalSurvivor.id);
	});

	it("rejects an alias that points a group to itself", () => {
		const group = seedGroup(db);

		expect(() =>
			db
				.insert(titleGroupAliases)
				.values({ retiredGroupId: group.id, survivorGroupId: group.id })
				.run(),
		).toThrow(/constraint/iu);
	});
});
