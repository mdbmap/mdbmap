import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { beforeEach, describe, expect, it } from "vitest";
import { user, watchStatus } from "./schema.ts";

const freshDb = () => {
	const sqlite = new Database(":memory:");
	sqlite.pragma("foreign_keys = ON");
	const db = drizzle(sqlite);
	migrate(db, { migrationsFolder: "schemas/drizzle" });
	return db;
};

describe("watch_status natural key", () => {
	let db: ReturnType<typeof freshDb>;
	const continuityKey = "continuity:demo";

	beforeEach(() => {
		db = freshDb();
		db.insert(user)
			.values({ email: "a@b.test", id: "user-1", name: "Ada" })
			.run();
		db.insert(watchStatus)
			.values({ continuityKey, status: "watching", userId: "user-1" })
			.run();
	});

	it("rejects a duplicate row for the same (user, continuity)", () => {
		expect(() =>
			db
				.insert(watchStatus)
				.values({ continuityKey, status: "completed", userId: "user-1" })
				.run(),
		).toThrow(/unique/iu);
	});

	it("upserts on the natural key rather than duplicating", () => {
		db.insert(watchStatus)
			.values({ continuityKey, status: "completed", userId: "user-1" })
			.onConflictDoUpdate({
				set: { status: "completed" },
				target: [watchStatus.userId, watchStatus.continuityKey],
			})
			.run();

		const rows = db.select().from(watchStatus).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe("completed");
	});
});
