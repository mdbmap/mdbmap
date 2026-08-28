import { describe, expect, it } from "vitest";

import { serviceCoverages } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";

import {
	completeCoverage,
	coverageStateFor,
	coverageStatesFor,
	groupCoverageKey,
	reconcileCoveragesAfterMerge,
	seedPendingCoverage,
} from "./coverage.ts";

const continuity = groupCoverageKey(42);
const revision = 1;

describe("overflow coverage", () => {
	it("seeds a pending row and stays idempotent on rerun", async () => {
		const db = await freshDb();
		await seedPendingCoverage(db, continuity, revision, "mal");
		await seedPendingCoverage(db, continuity, revision, "mal");
		expect(await db.select().from(serviceCoverages).all()).toHaveLength(1);
		expect(await coverageStateFor(db, continuity, revision, "mal")).toBe(
			"pending",
		);
	});

	it("flips a seeded service to complete atomically", async () => {
		const db = await freshDb();
		await seedPendingCoverage(db, continuity, revision, "mal");
		await completeCoverage(db, continuity, revision, "mal");
		expect(await db.select().from(serviceCoverages).all()).toHaveLength(1);
		expect(await coverageStateFor(db, continuity, revision, "mal")).toBe(
			"complete",
		);
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
		expect(states.get("kitsu")).toBe("pending");
	});
});

describe("reconcileCoveragesAfterMerge", () => {
	it("deletes retired group keys and seeds survivor pending at next revision", async () => {
		const db = await freshDb();
		const survivor = groupCoverageKey(1);
		const retired = groupCoverageKey(2);
		await seedPendingCoverage(db, retired, 1, "tmdb");
		await completeCoverage(db, retired, 1, "tmdb");
		await reconcileCoveragesAfterMerge(db, {
			retiredGroupIds: [2],
			survivorGroupId: 1,
		});
		const rows = await db.select().from(serviceCoverages).all();
		expect(rows.every((row) => row.baselineContinuity !== retired)).toBe(true);
		expect(await coverageStateFor(db, survivor, 2, "tmdb")).toBe("pending");
	});

	it("avoids UNIQUE collision when survivor and retired share service revision", async () => {
		const db = await freshDb();
		const survivor = groupCoverageKey(10);
		const retired = groupCoverageKey(11);
		await seedPendingCoverage(db, survivor, 1, "mal");
		await completeCoverage(db, survivor, 1, "mal");
		await seedPendingCoverage(db, retired, 1, "mal");
		await completeCoverage(db, retired, 1, "mal");
		await reconcileCoveragesAfterMerge(db, {
			retiredGroupIds: [11],
			survivorGroupId: 10,
		});
		const rows = await db.select().from(serviceCoverages).all();
		expect(
			rows.filter((row) => row.baselineContinuity === retired),
		).toHaveLength(0);
		expect(await coverageStateFor(db, survivor, 1, "mal")).toBe("complete");
		expect(await coverageStateFor(db, survivor, 2, "mal")).toBe("pending");
	});
});
