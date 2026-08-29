import { beforeEach, describe, expect, it } from "vitest";

import { serviceCoverages } from "@/db/engine-schema";
import type { CoverageState } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";

import { runIngestStatus } from "./status.ts";

type Db = Awaited<ReturnType<typeof freshDb>>;

const seedCoverage = async (db: Db, state: CoverageState): Promise<number> => {
	const row = await db
		.insert(serviceCoverages)
		.values({
			baselineContinuity: "group:1",
			revision: 1,
			state,
			targetService: "imdb",
		})
		.returning({ id: serviceCoverages.id })
		.get();
	if (row === undefined) {
		throw new Error("expected an inserted coverage row");
	}
	return row.id;
};

const statusFor = (id: number): string => `pending:${id.toString(36)}`;

describe("ingest status gateway", () => {
	let db: Db;

	beforeEach(async () => {
		db = await freshDb();
	});

	it("reports a pending coverage row as running", async () => {
		const id = await seedCoverage(db, "pending");

		const response = await runIngestStatus(statusFor(id), { db });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({
			retryAfterSeconds: 5,
			status: "running",
		});
	});

	it("reports a completed coverage row as complete", async () => {
		const id = await seedCoverage(db, "complete");

		const response = await runIngestStatus(statusFor(id), { db });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status: "complete" });
	});

	const terminalCases = [
		["open", "complete"],
		["conflict", "conflict"],
	] satisfies readonly (readonly [CoverageState, string])[];

	it.each(terminalCases)("reports %s coverage as %s", async (state, status) => {
		const id = await seedCoverage(db, state);

		const response = await runIngestStatus(statusFor(id), { db });

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ status });
	});

	it.each(["pending:", "pending:1!", "review:1", "workflow-instance"])(
		"returns 404 for malformed ref %s",
		async (ref) => {
			const response = await runIngestStatus(ref, { db });

			expect(response.status).toBe(404);
		},
	);

	it("returns 404 for an unknown coverage row", async () => {
		const response = await runIngestStatus("pending:1", { db });

		expect(response.status).toBe(404);
	});
});
