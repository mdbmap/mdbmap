import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import {
	contentUnits,
	instalmentAssertions,
	relationAssertions,
	serviceInstalments,
	serviceTitles,
	titleAssertions,
	titleGroups,
} from "./engine-schema.ts";

const freshDb = () => {
	const sqlite = new Database(":memory:");
	sqlite.pragma("foreign_keys = ON");
	const db = drizzle(sqlite);
	migrate(db, { migrationsFolder: "schemas/drizzle" });
	return db;
};

const one = <Row>(rows: Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected an inserted row");
	}
	return row;
};

const seedTitle = (
	db: ReturnType<typeof freshDb>,
	service: string,
	serviceId: string,
) => {
	const group = one(
		db
			.insert(titleGroups)
			.values({ ladderComplete: false, source: "t1-structure" })
			.returning()
			.all(),
	);
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
});
