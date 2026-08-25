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
	it("seeds a pending row and stays idempotent on rerun", () => {
		const db = freshDb();
		seedPendingCoverage(db, continuity, revision, "mal");
		seedPendingCoverage(db, continuity, revision, "mal");
		expect(db.select().from(serviceCoverages).all()).toHaveLength(1);
		expect(coverageStateFor(db, continuity, revision, "mal")).toBe("pending");
	});

	it("flips a seeded service to complete atomically", () => {
		const db = freshDb();
		seedPendingCoverage(db, continuity, revision, "mal");
		completeCoverage(db, continuity, revision, "mal");
		expect(db.select().from(serviceCoverages).all()).toHaveLength(1);
		expect(coverageStateFor(db, continuity, revision, "mal")).toBe("complete");
	});

	it("never lets a reader observe a partial group", () => {
		const db = freshDb();
		for (const service of ["anilist", "kitsu", "mal"] as const) {
			seedPendingCoverage(db, continuity, revision, service);
		}
		completeCoverage(db, continuity, revision, "anilist");
		completeCoverage(db, continuity, revision, "mal");
		const states = coverageStatesFor(db, continuity, revision);
		expect(states.get("anilist")).toBe("complete");
		expect(states.get("mal")).toBe("complete");
		// The service still mid-build reads pending, not a silent no-counterpart.
		expect(states.get("kitsu")).toBe("pending");
	});
});
