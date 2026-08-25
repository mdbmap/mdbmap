import { beforeEach, describe, expect, it } from "vitest";
import { user, watchStatus } from "./schema.ts";
import { freshDb, rejectionText } from "./test-helpers.ts";

describe("watch_status natural key", () => {
	let db: Awaited<ReturnType<typeof freshDb>>;
	const continuityKey = "continuity:demo";

	beforeEach(async () => {
		db = await freshDb();
		await db
			.insert(user)
			.values({ email: "a@b.test", id: "user-1", name: "Ada" })
			.run();
		await db
			.insert(watchStatus)
			.values({ continuityKey, status: "watching", userId: "user-1" })
			.run();
	});

	it("rejects a duplicate row for the same (user, continuity)", async () => {
		const message = await rejectionText(
			db
				.insert(watchStatus)
				.values({ continuityKey, status: "completed", userId: "user-1" })
				.run(),
		);
		expect(message).toMatch(/unique/iu);
	});

	it("upserts on the natural key rather than duplicating", async () => {
		await db
			.insert(watchStatus)
			.values({ continuityKey, status: "completed", userId: "user-1" })
			.onConflictDoUpdate({
				set: { status: "completed" },
				target: [watchStatus.userId, watchStatus.continuityKey],
			})
			.run();

		const rows = await db.select().from(watchStatus).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.status).toBe("completed");
	});
});
