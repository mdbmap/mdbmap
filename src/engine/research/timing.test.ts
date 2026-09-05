import { describe, expect, it } from "vitest";

import { freshDb } from "@/db/test-helpers";

import {
	createDbTimingStore,
	createMemoryTimingStore,
	isResearchTiming,
	researchTimings,
	shouldRunResearch,
} from "./timing.ts";

describe("research timing config reader", () => {
	it("exposes the three ADR-0004 policy values", () => {
		expect(researchTimings).toEqual(["before-builds", "after-residue", "off"]);
		expect(isResearchTiming("off")).toBe(true);
		expect(isResearchTiming("whenever")).toBe(false);
	});

	it("defaults the stub reader to off so a missing admin panel is safe", async () => {
		const store = createMemoryTimingStore();
		expect(await store.read()).toBe("off");
		expect(shouldRunResearch(await store.read(), "before-builds")).toBe(false);
	});

	it("adapts the admin-backed research_policy store", async () => {
		const db = await freshDb();
		const store = createDbTimingStore(db);
		expect(await store.read()).toBe("off");
		await store.write("before-builds");
		expect(await store.read()).toBe("before-builds");
		await store.write("after-residue");
		expect(await store.read()).toBe("after-residue");
	});
});
