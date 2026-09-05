import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { ascendingPair } from "@/db";
import {
	contentUnits,
	instalmentAssertions,
	pendingGroupCandidates,
	relationAssertions,
	serviceInstalments,
	serviceTitles,
	titleAssertions,
	titleGroups,
} from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import type { CatalogueTitle } from "@/engine/discovery";
import { createBudget } from "@/engine/matcher";
import { revalidateGroup } from "@/engine/revalidation";

import { sampleResearchRecheck } from "./recheck.ts";
import type { ResearchCatalogueClient } from "./tools.ts";

type TestDb = Awaited<ReturnType<typeof freshDb>>;

const one = <Row>(rows: readonly Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected an inserted row");
	}
	return row;
};

const seedGroup = async (db: TestDb) =>
	one(
		await db
			.insert(titleGroups)
			.values({ ladderComplete: true, source: "t1-structure" })
			.returning()
			.all(),
	);

const seedTitle = async (
	db: TestDb,
	groupId: number,
	service: string,
	serviceId: string,
) =>
	one(
		await db
			.insert(serviceTitles)
			.values({ groupId, service, serviceId })
			.returning()
			.all(),
	);

const seedUnit = async (db: TestDb) =>
	one(await db.insert(contentUnits).values({}).returning().all()).id;

const seedSpoke = async (db: TestDb, titleId: number, locator: string) =>
	one(
		await db
			.insert(serviceInstalments)
			.values({ locator, locatorKind: "position", titleId })
			.returning()
			.all(),
	);

const catalogue = (
	title: string,
	instalments: readonly { readonly locator: string }[] = [],
): CatalogueTitle & {
	readonly instalments: readonly { readonly locator: string }[];
} => ({
	format: "series",
	instalmentCount: instalments.length,
	instalments,
	releaseDate: "2020-01-01",
	title,
});

const clientFor = (
	records: Record<string, ReturnType<typeof catalogue>>,
): ResearchCatalogueClient => ({
	fetchCatalogue: (serviceId) => records[serviceId],
	fetchTitle: (serviceId) => records[serviceId],
});

describe("sampleResearchRecheck", () => {
	let db: TestDb;

	beforeEach(async () => {
		db = await freshDb();
	});

	it("flags a title assertion when live catalogues no longer agree", async () => {
		const group = await seedGroup(db);
		const titleA = await seedTitle(db, group.id, "tmdb", "1");
		const titleB = await seedTitle(db, group.id, "imdb", "tt1");
		const [titleAId, titleBId] = ascendingPair(titleA.id, titleB.id);
		await db
			.insert(titleAssertions)
			.values({
				confidence: "high",
				source: "llm-research",
				titleAId,
				titleBId,
			})
			.run();

		const outcome = await sampleResearchRecheck(db, {
			budget: createBudget(4),
			clients: {
				imdb: clientFor({ tt1: catalogue("Different Show") }),
				tmdb: clientFor({ "1": catalogue("Example Show") }),
			},
			groupId: group.id,
		});

		expect(outcome.checked).toBe(1);
		expect(outcome.flagged).toBe(1);

		const assertion = one(
			await db
				.select({ confidence: titleAssertions.confidence })
				.from(titleAssertions)
				.all(),
		);
		expect(assertion.confidence).toBe("low");

		const queued = await db.select().from(pendingGroupCandidates).all();
		expect(queued).toHaveLength(1);
		expect(queued[0]?.kind).toBe("low-confidence-flag");
	});

	it("leaves a matching title assertion intact", async () => {
		const group = await seedGroup(db);
		const titleA = await seedTitle(db, group.id, "tmdb", "1");
		const titleB = await seedTitle(db, group.id, "imdb", "tt1");
		const [titleAId, titleBId] = ascendingPair(titleA.id, titleB.id);
		await db
			.insert(titleAssertions)
			.values({
				confidence: "high",
				source: "llm-research",
				titleAId,
				titleBId,
			})
			.run();

		const outcome = await sampleResearchRecheck(db, {
			budget: createBudget(4),
			clients: {
				imdb: clientFor({ tt1: catalogue("Example Show") }),
				tmdb: clientFor({ "1": catalogue("Example Show") }),
			},
			groupId: group.id,
		});

		expect(outcome.checked).toBe(1);
		expect(outcome.flagged).toBe(0);

		const assertion = one(
			await db
				.select({ confidence: titleAssertions.confidence })
				.from(titleAssertions)
				.all(),
		);
		expect(assertion.confidence).toBe("high");
		expect(await db.select().from(pendingGroupCandidates).all()).toHaveLength(
			0,
		);
	});

	it("skips unaffordable assertions and still samples cheaper later ones", async () => {
		const group = await seedGroup(db);
		const titleA = await seedTitle(db, group.id, "tmdb", "1");
		const titleB = await seedTitle(db, group.id, "imdb", "tt1");
		const instalmentTitle = await seedTitle(db, group.id, "tmdb", "2");
		const spoke = await seedSpoke(db, instalmentTitle.id, "1:1");
		const unitId = await seedUnit(db);
		const [titleAId, titleBId] = ascendingPair(titleA.id, titleB.id);
		await db
			.insert(titleAssertions)
			.values({
				confidence: "high",
				source: "llm-research",
				titleAId,
				titleBId,
			})
			.run();
		await db
			.insert(instalmentAssertions)
			.values({
				confidence: "high",
				instalmentId: spoke.id,
				source: "llm-research",
				unitId,
			})
			.run();

		const outcome = await sampleResearchRecheck(db, {
			budget: createBudget(1),
			clients: {
				imdb: clientFor({ tt1: catalogue("Second") }),
				tmdb: clientFor({
					"1": catalogue("First"),
					"2": catalogue("Instalment Show", [{ locator: "1:1" }]),
				}),
			},
			groupId: group.id,
		});

		expect(outcome.checked).toBe(1);
		expect(outcome.remainingBudget).toBe(0);
	});

	it("respects the remaining revalidation budget", async () => {
		const group = await seedGroup(db);
		const titleA = await seedTitle(db, group.id, "tmdb", "1");
		const titleB = await seedTitle(db, group.id, "imdb", "tt1");
		const titleC = await seedTitle(db, group.id, "anidb", "9");
		const [pairOneA, pairOneB] = ascendingPair(titleA.id, titleB.id);
		const [pairTwoA, pairTwoB] = ascendingPair(titleB.id, titleC.id);
		await db
			.insert(titleAssertions)
			.values([
				{
					confidence: "high",
					source: "llm-research",
					titleAId: pairOneA,
					titleBId: pairOneB,
				},
				{
					confidence: "high",
					source: "llm-research",
					titleAId: pairTwoA,
					titleBId: pairTwoB,
				},
			])
			.run();

		const outcome = await sampleResearchRecheck(db, {
			budget: createBudget(2),
			clients: {
				anidb: clientFor({ "9": catalogue("Third") }),
				imdb: clientFor({ tt1: catalogue("Second") }),
				tmdb: clientFor({ "1": catalogue("First") }),
			},
			groupId: group.id,
		});

		expect(outcome.checked).toBe(1);
		expect(outcome.remainingBudget).toBe(0);
	});

	it("flags instalment assertions when the locator disappears from live data", async () => {
		const group = await seedGroup(db);
		const title = await seedTitle(db, group.id, "tmdb", "1");
		const spoke = await seedSpoke(db, title.id, "1:1");
		const unitId = await seedUnit(db);
		await db
			.insert(instalmentAssertions)
			.values({
				confidence: "high",
				instalmentId: spoke.id,
				source: "llm-research",
				unitId,
			})
			.run();

		await sampleResearchRecheck(db, {
			budget: createBudget(1),
			clients: {
				tmdb: clientFor({ "1": catalogue("Example Show", []) }),
			},
			groupId: group.id,
		});

		const assertion = one(
			await db
				.select({ confidence: instalmentAssertions.confidence })
				.from(instalmentAssertions)
				.all(),
		);
		expect(assertion.confidence).toBe("low");
	});

	it("skips relation assertions when a live endpoint is unavailable", async () => {
		const group = await seedGroup(db);
		const from = await seedTitle(db, group.id, "tmdb", "1");
		const to = await seedTitle(db, group.id, "imdb", "tt2");
		await db
			.insert(relationAssertions)
			.values({
				confidence: "high",
				fromTitleId: from.id,
				source: "llm-research",
				toTitleId: to.id,
			})
			.run();

		const outcome = await sampleResearchRecheck(db, {
			budget: createBudget(2),
			clients: {
				imdb: clientFor({ tt2: catalogue("Sequel Show") }),
			},
			groupId: group.id,
		});

		expect(outcome.checked).toBe(1);
		expect(outcome.flagged).toBe(0);

		const assertion = one(
			await db
				.select({ confidence: relationAssertions.confidence })
				.from(relationAssertions)
				.all(),
		);
		expect(assertion.confidence).toBe("high");
	});

	it("flags relation assertions when a live endpoint returns an empty title", async () => {
		const group = await seedGroup(db);
		const from = await seedTitle(db, group.id, "tmdb", "1");
		const to = await seedTitle(db, group.id, "imdb", "tt2");
		const assertion = one(
			await db
				.insert(relationAssertions)
				.values({
					confidence: "high",
					fromTitleId: from.id,
					source: "llm-research",
					toTitleId: to.id,
				})
				.returning()
				.all(),
		);

		const outcome = await sampleResearchRecheck(db, {
			budget: createBudget(2),
			clients: {
				imdb: clientFor({ tt2: catalogue("Sequel Show") }),
				tmdb: clientFor({ "1": catalogue(" ") }),
			},
			groupId: group.id,
		});

		expect(outcome.checked).toBe(1);
		expect(outcome.flagged).toBe(1);

		const demoted = one(
			await db
				.select({ confidence: relationAssertions.confidence })
				.from(relationAssertions)
				.where(eq(relationAssertions.id, assertion.id))
				.all(),
		);
		expect(demoted.confidence).toBe("low");
	});
});

describe("revalidateGroup", () => {
	let db: TestDb;

	beforeEach(async () => {
		db = await freshDb();
	});

	it("runs recompute then samples llm-research assertions on the shared budget", async () => {
		const group = await seedGroup(db);
		const titleA = await seedTitle(db, group.id, "tmdb", "1");
		const titleB = await seedTitle(db, group.id, "imdb", "tt1");
		const spokeA = await seedSpoke(db, titleA.id, "1:1");
		const spokeB = await seedSpoke(db, titleB.id, "1:1");
		const [titleAId, titleBId] = ascendingPair(titleA.id, titleB.id);
		await db
			.insert(titleAssertions)
			.values({
				confidence: "high",
				source: "llm-research",
				titleAId,
				titleBId,
			})
			.run();

		const outcome = await revalidateGroup(db, {
			budgetLimit: 2,
			clients: {
				imdb: clientFor({ tt1: catalogue("Mismatch") }),
				tmdb: clientFor({ "1": catalogue("Example Show") }),
			},
			groupId: group.id,
			ladderComplete: true,
			pairings: [
				{
					confidence: "high",
					source: "t3-episode",
					spokeIds: [spokeA.id, spokeB.id],
				},
			],
			triedSource: "t3-episode",
		});

		expect(outcome.kind).toBe("applied");
		if (outcome.kind !== "applied") {
			return;
		}
		expect(outcome.recheck.checked).toBe(1);
		expect(outcome.recheck.flagged).toBe(1);
		expect(outcome.budget.remaining).toBe(0);

		const stillResearch = await db
			.select({ id: titleAssertions.id })
			.from(titleAssertions)
			.where(
				and(
					eq(titleAssertions.source, "llm-research"),
					eq(titleAssertions.titleAId, titleAId),
					eq(titleAssertions.titleBId, titleBId),
				),
			)
			.all();
		expect(stillResearch).toHaveLength(1);
	});
});
