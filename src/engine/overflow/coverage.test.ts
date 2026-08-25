import { describe, expect, it } from "vitest";

import { serviceCoverages } from "@/db/engine-schema";
import type { ContinuityKey } from "@/db/schema.ts";
import { freshDb } from "@/db/test-helpers";

import {
	completeCoverage,
	coverageStateFor,
	coverageStatesFor,
	seedPendingCoverage,
} from "./coverage.ts";

const continuity: ContinuityKey = "simkl:anime:42";
const revision = 1;

describe("overflow coverage", () => {
	it("seeds a pending row and stays idempotent on rerun", async () => {
		const db = await freshDb();
		await seedPendingCoverage(db, continuity, revision, "mal");
		await seedPendingCoverage(db, continuity, revision, "mal");
		expect(await db.select().from(serviceCoverages).all()).toHaveLength(1);
		expect(await coverageStateFor(db, continuity, revision, "mal")).toBe("pending");
	});

	it("flips a seeded service to complete atomically", async () => {
		const db = await freshDb();
		await seedPendingCoverage(db, continuity, revision, "mal");
		await completeCoverage(db, continuity, revision, "mal");
		expect(await db.select().from(serviceCoverages).all()).toHaveLength(1);
		expect(await coverageStateFor(db, continuity, revision, "mal")).toBe("complete");
	});

	it("never lets a reader observe a partial group", async () => {
		const db = await freshDb();
		await Promise.all(
			(["anilist", "kitsu", "mal"] as const).map(async (service) =>
				seedPendingCoverage(db, continuity, revision, service),
			),
		);
		await completeCoverage(db, continuity, revision, "anilist");
		await completeCoverage(db, continuity, revision, "mal");
		const states = await coverageStatesFor(db, continuity, revision);
		expect(states.get("anilist")).toBe("complete");
		expect(states.get("mal")).toBe("complete");
		// The service still mid-build reads pending, not a silent no-counterpart.
		expect(states.get("kitsu")).toBe("pending");
	});
});
