import { describe, expect, it } from "vitest";

import { freshDb } from "@/db/test-helpers.ts";

import {
	DEFAULT_TIMING,
	getResearchTiming,
	setResearchTiming,
} from "./timing.ts";

describe("research timing policy", () => {
	it("defaults to off when unset", async () => {
		const db = await freshDb();
		await expect(getResearchTiming(db)).resolves.toBe(DEFAULT_TIMING);
	});

	it("persists a timing the research orchestrator can read", async () => {
		const db = await freshDb();
		await expect(setResearchTiming(db, "before-builds")).resolves.toBe(
			"before-builds",
		);
		await expect(getResearchTiming(db)).resolves.toBe("before-builds");

		await setResearchTiming(db, "after-residue");
		await expect(getResearchTiming(db)).resolves.toBe("after-residue");

		await setResearchTiming(db, "off");
		await expect(getResearchTiming(db)).resolves.toBe("off");
	});
});
