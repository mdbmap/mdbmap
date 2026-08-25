import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";

import { personalRating, user } from "@/db/schema";
import type { RateableUnit } from "@/orpc/schema";

import { communityScoreProvider } from "./community.ts";

const freshDb = () => {
	const sqlite = new Database(":memory:");
	sqlite.pragma("foreign_keys = ON");
	const db = drizzle(sqlite);
	migrate(db, { migrationsFolder: "schemas/drizzle" });
	return db;
};

describe("community score derivation", () => {
	let db: ReturnType<typeof freshDb>;
	const part: RateableUnit = { key: "part:demo:0", kind: "part" };
	const episode: RateableUnit = { key: "episode:demo:1", kind: "episode" };

	const rate = (userId: string, unit: RateableUnit, score: number) =>
		db
			.insert(personalRating)
			.values({ score, unitKey: unit.key, unitKind: unit.kind, userId })
			.run();

	beforeEach(() => {
		db = freshDb();
		for (const id of ["user-1", "user-2", "user-3"]) {
			db.insert(user).values({ email: `${id}@b.test`, id, name: id }).run();
		}
	});

	it("averages every user's rating for the unit with a count", async () => {
		rate("user-1", part, 6);
		rate("user-2", part, 8);
		rate("user-3", part, 10);

		expect(await communityScoreProvider.scoreFor(part, db)).toEqual({
			count: 3,
			mean: 8,
		});
	});

	it("has no score when nobody has rated the unit", async () => {
		expect(await communityScoreProvider.scoreFor(part, db)).toEqual({
			count: 0,
			mean: undefined,
		});
	});

	it("aggregates each unit independently and never leaks across them", async () => {
		rate("user-1", part, 4);
		rate("user-2", part, 6);
		rate("user-3", episode, 10);

		expect(await communityScoreProvider.scoreFor(part, db)).toEqual({
			count: 2,
			mean: 5,
		});
		expect(await communityScoreProvider.scoreFor(episode, db)).toEqual({
			count: 1,
			mean: 10,
		});
	});
});
