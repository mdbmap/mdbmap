import { describe, expect, it } from "vitest";

import { freshDb } from "@/db/test-helpers";
import { setResearchTiming } from "@/lib/research-policy";

import { resolveResearchSchedule } from "./schedule.ts";

describe("resolveResearchSchedule", () => {
	it("skips when policy is off (default)", async () => {
		const db = await freshDb();
		await expect(resolveResearchSchedule(db)).resolves.toEqual({ run: false });
	});

	it("places the pass before builds when configured", async () => {
		const db = await freshDb();
		await setResearchTiming(db, "before-builds");
		await expect(resolveResearchSchedule(db)).resolves.toEqual({
			run: true,
			when: "before-builds",
		});
	});

	it("places the pass after residue when configured", async () => {
		const db = await freshDb();
		await setResearchTiming(db, "after-residue");
		await expect(resolveResearchSchedule(db)).resolves.toEqual({
			run: true,
			when: "after-residue",
		});
	});
});
