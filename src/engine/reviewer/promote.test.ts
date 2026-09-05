import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
	contentUnits,
	instalmentAssertions,
	relationAssertions,
	serviceInstalments,
	titleAssertions,
} from "@/db/engine-schema";
import type { AssertionSource } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";

import { promoteAssertion } from "./promote.ts";
import { ascendingPair, one, seedTitle } from "./test-fixtures.ts";
import type { TestDb as Db } from "./test-fixtures.ts";

const seedTitleAssertion = async (
	db: Db,
	source: AssertionSource,
): Promise<number> => {
	const left = await seedTitle(db, "tmdb", "1396");
	const right = await seedTitle(db, "tvdb", "81189");
	const [lowId, highId] = ascendingPair(left.id, right.id);
	return one(
		await db
			.insert(titleAssertions)
			.values({
				confidence: "low",
				source,
				titleAId: lowId,
				titleBId: highId,
			})
			.returning()
			.all(),
	).id;
};

const seedRelationAssertion = async (
	db: Db,
	source: AssertionSource,
): Promise<number> => {
	const from = await seedTitle(db, "tmdb", "from");
	const to = await seedTitle(db, "tmdb", "to");
	return one(
		await db
			.insert(relationAssertions)
			.values({
				confidence: "low",
				fromTitleId: from.id,
				source,
				toTitleId: to.id,
			})
			.returning()
			.all(),
	).id;
};

const seedInstalmentAssertion = async (
	db: Db,
	source: AssertionSource,
): Promise<number> => {
	const title = await seedTitle(db, "tmdb", "1396");
	const instalment = one(
		await db
			.insert(serviceInstalments)
			.values({ locator: "s1e1", locatorKind: "position", titleId: title.id })
			.returning()
			.all(),
	);
	const unit = one(await db.insert(contentUnits).values({}).returning().all());
	return one(
		await db
			.insert(instalmentAssertions)
			.values({
				confidence: "low",
				instalmentId: instalment.id,
				source,
				unitId: unit.id,
			})
			.returning()
			.all(),
	).id;
};

describe("promoteAssertion", () => {
	let db: Db;

	beforeEach(async () => {
		db = await freshDb();
	});

	it("promotes a title assertion from llm-research to llm-verified", async () => {
		const id = await seedTitleAssertion(db, "llm-research");
		expect(await promoteAssertion(db, "title", id)).toBe("promoted");
		const row = one(
			await db
				.select()
				.from(titleAssertions)
				.where(eq(titleAssertions.id, id))
				.all(),
		);
		expect(row.source).toBe("llm-verified");
	});

	it("promotes a relation assertion from llm-research to llm-verified", async () => {
		const id = await seedRelationAssertion(db, "llm-research");
		expect(await promoteAssertion(db, "relation", id)).toBe("promoted");
		const row = one(
			await db
				.select()
				.from(relationAssertions)
				.where(eq(relationAssertions.id, id))
				.all(),
		);
		expect(row.source).toBe("llm-verified");
	});

	it("promotes an instalment assertion from llm-research to llm-verified", async () => {
		const id = await seedInstalmentAssertion(db, "llm-research");
		expect(await promoteAssertion(db, "instalment", id)).toBe("promoted");
		const row = one(
			await db
				.select()
				.from(instalmentAssertions)
				.where(eq(instalmentAssertions.id, id))
				.all(),
		);
		expect(row.source).toBe("llm-verified");
	});

	it("reports already-moved without touching a row that no longer carries llm-research", async () => {
		const id = await seedTitleAssertion(db, "manual");
		expect(await promoteAssertion(db, "title", id)).toBe("already-moved");
		const row = one(
			await db
				.select()
				.from(titleAssertions)
				.where(eq(titleAssertions.id, id))
				.all(),
		);
		expect(row.source).toBe("manual");
	});

	it("reports already-moved on a repeat promote of the same row", async () => {
		const id = await seedTitleAssertion(db, "llm-research");
		expect(await promoteAssertion(db, "title", id)).toBe("promoted");
		expect(await promoteAssertion(db, "title", id)).toBe("already-moved");
	});

	it("reports missing for an id that does not exist", async () => {
		expect(await promoteAssertion(db, "title", 999_999)).toBe("missing");
	});
});
