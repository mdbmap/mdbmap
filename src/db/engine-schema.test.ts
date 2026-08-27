import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
	candidateSubjectKey,
	contentUnits,
	continuities,
	continuitySegments,
	instalmentAssertions,
	pendingGroupCandidates,
	presentationOrders,
	relationAssertions,
	serviceInstalments,
	serviceTitles,
	titleAssertions,
	titleGroupAliases,
	titleGroups,
} from "./engine-schema.ts";
import { freshDb, rejectionText } from "./test-helpers.ts";

type Db = Awaited<ReturnType<typeof freshDb>>;

const one = <Row>(rows: Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected an inserted row");
	}
	return row;
};

const seedGroup = async (db: Db) =>
	one(
		await db
			.insert(titleGroups)
			.values({ ladderComplete: false, source: "t1-structure" })
			.returning()
			.all(),
	);

const seedTitle = async (db: Db, service: string, serviceId: string) => {
	const group = await seedGroup(db);
	return one(
		await db
			.insert(serviceTitles)
			.values({ groupId: group.id, service, serviceId })
			.returning()
			.all(),
	);
};

const seedInstalment = async (db: Db, titleId: number, locator: string) =>
	one(
		await db
			.insert(serviceInstalments)
			.values({ locator, locatorKind: "position", titleId })
			.returning()
			.all(),
	);

const seedUnit = async (db: Db) =>
	one(await db.insert(contentUnits).values({}).returning().all());

describe("hub-and-spoke coverage edges", () => {
	let db: Db;

	beforeEach(async () => {
		db = await freshDb();
	});

	it("lets a merged instalment cover two content units", async () => {
		const title = await seedTitle(db, "tmdb", "1396");
		const instalment = await seedInstalment(db, title.id, "s1e12");
		const unitA = await seedUnit(db);
		const unitB = await seedUnit(db);

		await db
			.insert(instalmentAssertions)
			.values(
				[unitA, unitB].map((unit) => ({
					confidence: "high" as const,
					instalmentId: instalment.id,
					source: "t3-episode" as const,
					unitId: unit.id,
				})),
			)
			.run();

		const rows = await db
			.select()
			.from(instalmentAssertions)
			.where(eq(instalmentAssertions.instalmentId, instalment.id))
			.all();
		expect(rows.map((row) => row.unitId).toSorted()).toEqual(
			[unitA.id, unitB.id].toSorted(),
		);
	});

	it("lets one content unit be covered by two spokes of a split", async () => {
		const title = await seedTitle(db, "imdb", "tt0903747");
		const spokeA = await seedInstalment(db, title.id, "s1e1");
		const spokeB = await seedInstalment(db, title.id, "s1e2");
		const unit = await seedUnit(db);

		await db
			.insert(instalmentAssertions)
			.values(
				[spokeA, spokeB].map((spoke) => ({
					confidence: "high" as const,
					instalmentId: spoke.id,
					source: "t3-episode" as const,
					unitId: unit.id,
				})),
			)
			.run();

		const rows = await db.select().from(instalmentAssertions).all();
		expect(
			rows
				.map((row) => row.instalmentId)
				.toSorted((left, right) => left - right),
		).toEqual([spokeA.id, spokeB.id].toSorted((left, right) => left - right));
	});

	it("rejects a title overlap edge that is reversed or self-referential", async () => {
		const first = await seedTitle(db, "tmdb", "first");
		const second = await seedTitle(db, "tmdb", "second");
		const [lower, higher] =
			first.id < second.id ? [first, second] : [second, first];

		const insertPair = async (titleAId: number, titleBId: number) =>
			db
				.insert(titleAssertions)
				.values({
					confidence: "high",
					source: "t1-structure",
					titleAId,
					titleBId,
				})
				.run();

		expect(await rejectionText(insertPair(higher.id, lower.id))).toMatch(
			/constraint/iu,
		);
		expect(await rejectionText(insertPair(lower.id, lower.id))).toMatch(
			/constraint/iu,
		);
		await insertPair(lower.id, higher.id);
	});

	it("rejects a second immediate sequel for one title", async () => {
		const from = await seedTitle(db, "tmdb", "from");
		const sequel = await seedTitle(db, "tmdb", "sequel");
		const rival = await seedTitle(db, "tmdb", "rival");

		await db
			.insert(relationAssertions)
			.values({
				confidence: "high",
				fromTitleId: from.id,
				source: "llm-verified",
				toTitleId: sequel.id,
			})
			.run();

		expect(
			await rejectionText(
				db
					.insert(relationAssertions)
					.values({
						confidence: "high",
						fromTitleId: from.id,
						source: "llm-verified",
						toTitleId: rival.id,
					})
					.run(),
			),
		).toMatch(/unique/iu);
	});

	it("rejects a relation asserting a title relates to itself", async () => {
		const title = await seedTitle(db, "tmdb", "self");

		expect(
			await rejectionText(
				db
					.insert(relationAssertions)
					.values({
						confidence: "high",
						fromTitleId: title.id,
						source: "llm-verified",
						toTitleId: title.id,
					})
					.run(),
			),
		).toMatch(/constraint/iu);
	});

	it("rejects a second immediate prequel for one title", async () => {
		const to = await seedTitle(db, "tmdb", "to");
		const prequel = await seedTitle(db, "tmdb", "prequel");
		const rival = await seedTitle(db, "tmdb", "rival");

		await db
			.insert(relationAssertions)
			.values({
				confidence: "high",
				fromTitleId: prequel.id,
				source: "llm-verified",
				toTitleId: to.id,
			})
			.run();

		expect(
			await rejectionText(
				db
					.insert(relationAssertions)
					.values({
						confidence: "high",
						fromTitleId: rival.id,
						source: "llm-verified",
						toTitleId: to.id,
					})
					.run(),
			),
		).toMatch(/unique/iu);
	});
});

describe("pending group candidates", () => {
	let db: Db;

	beforeEach(async () => {
		db = await freshDb();
	});

	it("coalesces a repeat open candidate but reopens on a differing evidence hash", async () => {
		const subject = { subjectType: "title" as const, titleId: 1 };
		const evidence = {
			competingGroupIds: [1, 2],
			kind: "structural" as const,
			proposedMembers: [{ service: "tmdb", serviceId: "1396" }],
		};

		await db
			.insert(pendingGroupCandidates)
			.values({
				evidence,
				evidenceHash: "hash-a",
				kind: "structural",
				subject,
				subjectKey: candidateSubjectKey(subject),
			})
			.run();

		const subjectKey = candidateSubjectKey(subject);
		expect(
			await rejectionText(
				db
					.insert(pendingGroupCandidates)
					.values({
						evidence,
						evidenceHash: "hash-a",
						kind: "structural",
						subject,
						subjectKey,
					})
					.run(),
			),
		).toMatch(/unique/iu);

		await db
			.insert(pendingGroupCandidates)
			.values({
				evidence,
				evidenceHash: "hash-b",
				kind: "structural",
				subject,
				subjectKey: candidateSubjectKey(subject),
			})
			.run();

		expect(await db.select().from(pendingGroupCandidates).all()).toHaveLength(
			2,
		);
	});

	it("coalesces subjects that differ only in json key order", async () => {
		const evidence = {
			competingGroupIds: [1, 2],
			kind: "structural" as const,
			proposedMembers: [{ service: "tmdb", serviceId: "1396" }],
		};
		const subject = { subjectType: "title" as const, titleId: 42 };
		// Same logical subject, keys serialised in the opposite order.
		const titleField = { titleId: 42 };
		const reordered = { ...titleField, subjectType: "title" as const };

		await db
			.insert(pendingGroupCandidates)
			.values({
				evidence,
				evidenceHash: "hash-a",
				kind: "structural",
				subject,
				subjectKey: candidateSubjectKey(subject),
			})
			.run();

		const reorderedKey = candidateSubjectKey(reordered);
		expect(
			await rejectionText(
				db
					.insert(pendingGroupCandidates)
					.values({
						evidence,
						evidenceHash: "hash-a",
						kind: "structural",
						subject: reordered,
						subjectKey: reorderedKey,
					})
					.run(),
			),
		).toMatch(/unique/iu);

		const other = { subjectType: "title" as const, titleId: 99 };
		await db
			.insert(pendingGroupCandidates)
			.values({
				evidence,
				evidenceHash: "hash-a",
				kind: "structural",
				subject: other,
				subjectKey: candidateSubjectKey(other),
			})
			.run();

		expect(await db.select().from(pendingGroupCandidates).all()).toHaveLength(
			2,
		);
	});

	it("names the title pair as the subject of a title-assertion conflict", async () => {
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

		await db
			.insert(pendingGroupCandidates)
			.values({
				evidence,
				evidenceHash: "hash-pair",
				kind: "title-assertion-conflict",
				subject,
				subjectKey: candidateSubjectKey(subject),
			})
			.run();

		const row = one(await db.select().from(pendingGroupCandidates).all());
		expect(row.subject).toEqual(subject);
		expect(row.evidence).toEqual(evidence);
	});

	it("lets a resolved candidate coexist with a fresh open row for the same question", async () => {
		const subject = { subjectType: "title" as const, titleId: 7 };
		const evidence = {
			competingGroupIds: [],
			kind: "structural" as const,
			proposedMembers: [],
		};

		await db
			.insert(pendingGroupCandidates)
			.values({
				evidence,
				evidenceHash: "hash-c",
				kind: "structural",
				status: "rejected",
				subject,
				subjectKey: candidateSubjectKey(subject),
			})
			.run();

		await db
			.insert(pendingGroupCandidates)
			.values({
				evidence,
				evidenceHash: "hash-c",
				kind: "structural",
				subject,
				subjectKey: candidateSubjectKey(subject),
			})
			.run();
	});
});

describe("title group aliases", () => {
	let db: Db;

	beforeEach(async () => {
		db = await freshDb();
	});

	it("resolves an alias to its survivor in one hop after a merge", async () => {
		const survivor = await seedGroup(db);
		const retired = await seedGroup(db);

		await db
			.insert(titleGroupAliases)
			.values({ retiredGroupId: retired.id, survivorGroupId: survivor.id })
			.run();

		const alias = one(
			await db
				.select()
				.from(titleGroupAliases)
				.where(eq(titleGroupAliases.retiredGroupId, retired.id))
				.all(),
		);
		expect(alias.survivorGroupId).toBe(survivor.id);
	});

	it("flattens a later merge so the original retired id still resolves in one hop", async () => {
		const finalSurvivor = await seedGroup(db);
		const middle = await seedGroup(db);
		const original = await seedGroup(db);

		// original merges into middle first.
		await db
			.insert(titleGroupAliases)
			.values({ retiredGroupId: original.id, survivorGroupId: middle.id })
			.run();

		// middle later merges into finalSurvivor; the writer flattens the
		// existing alias instead of leaving an alias-of-alias chain.
		await db
			.update(titleGroupAliases)
			.set({ survivorGroupId: finalSurvivor.id })
			.where(eq(titleGroupAliases.retiredGroupId, original.id))
			.run();
		await db
			.insert(titleGroupAliases)
			.values({
				retiredGroupId: middle.id,
				survivorGroupId: finalSurvivor.id,
			})
			.run();

		const resolved = one(
			await db
				.select()
				.from(titleGroupAliases)
				.where(eq(titleGroupAliases.retiredGroupId, original.id))
				.all(),
		);
		expect(resolved.survivorGroupId).toBe(finalSurvivor.id);
	});

	it("rejects an alias that points a group to itself", async () => {
		const group = await seedGroup(db);

		expect(
			await rejectionText(
				db
					.insert(titleGroupAliases)
					.values({ retiredGroupId: group.id, survivorGroupId: group.id })
					.run(),
			),
		).toMatch(/constraint/iu);
	});
});

describe("presentation orders", () => {
	let db: Db;

	beforeEach(async () => {
		db = await freshDb();
	});

	it("rejects a second default order on the same continuity", async () => {
		const group = await seedGroup(db);
		const title = one(
			await db
				.insert(serviceTitles)
				.values({ groupId: group.id, service: "tmdb", serviceId: "tv:1" })
				.returning()
				.all(),
		);
		const continuity = one(
			await db
				.insert(continuities)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		await db
			.insert(continuitySegments)
			.values({
				continuityId: continuity.id,
				kind: "episodic",
				releaseOrdinal: 0,
				titleId: title.id,
			})
			.run();
		await db
			.insert(presentationOrders)
			.values({
				continuityId: continuity.id,
				isDefault: true,
				label: "Release",
				slug: "release",
			})
			.run();

		expect(
			await rejectionText(
				db
					.insert(presentationOrders)
					.values({
						continuityId: continuity.id,
						isDefault: true,
						label: "Watch",
						slug: "watch",
					})
					.run(),
			),
		).toMatch(/unique/iu);
	});

	it("rejects a matching-order slug", async () => {
		const group = await seedGroup(db);
		const title = one(
			await db
				.insert(serviceTitles)
				.values({ groupId: group.id, service: "tmdb", serviceId: "tv:1" })
				.returning()
				.all(),
		);
		const continuity = one(
			await db
				.insert(continuities)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		await db
			.insert(continuitySegments)
			.values({
				continuityId: continuity.id,
				kind: "episodic",
				releaseOrdinal: 0,
				titleId: title.id,
			})
			.run();

		expect(
			await rejectionText(
				db.run(
					sql`insert into presentation_orders (continuity_id, is_default, label, slug) values (${continuity.id}, 1, 'Matching', 't1-structure')`,
				),
			),
		).toMatch(/constraint/iu);
	});
});
