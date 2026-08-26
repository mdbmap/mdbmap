import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { runAtomicBatch } from "./atomic.ts";
import type { PreparedBatch } from "./atomic.ts";
import { atomicWriteGates, titleGroups } from "./engine-schema.ts";
import { freshDb } from "./test-helpers.ts";

describe("atomic D1 batches", () => {
	it("rolls back every statement when one fails", async () => {
		const db = await freshDb();
		const [group] = await db
			.insert(titleGroups)
			.values({ source: "t1-structure" })
			.returning()
			.all();
		if (group === undefined) {
			throw new Error("title group insert returned no row");
		}

		await expect(
			runAtomicBatch(db, (database, operationId) => {
				const statements: PreparedBatch = [
					database
						.prepare(
							"INSERT INTO atomic_write_gates (operation_id) VALUES (?) RETURNING operation_id",
						)
						.bind(operationId),
					database
						.prepare(`UPDATE title_groups SET source = 'manual'
							WHERE id = ? AND EXISTS (
								SELECT 1 FROM atomic_write_gates WHERE operation_id = ?
							)`)
						.bind(group.id, operationId),
					database
						.prepare(
							"INSERT INTO title_groups (id, source) VALUES (?, 't1-structure')",
						)
						.bind(group.id),
				];
				return statements;
			}),
		).rejects.toThrow();

		const [stored] = await db
			.select()
			.from(titleGroups)
			.where(eq(titleGroups.id, group.id))
			.all();
		expect(stored?.source).toBe("t1-structure");
		expect(await db.select().from(atomicWriteGates).all()).toEqual([]);
	});
});
