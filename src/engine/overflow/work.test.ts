import { describe, expect, it } from "vitest";

import { overflowInstanceId } from "./work.ts";
import type { BuildWork } from "./work.ts";

const work: BuildWork = {
	baselineRevision: 3,
	continuity: "simkl:anime:42",
	targetService: "mal",
};

describe("overflowInstanceId", () => {
	it("is deterministic for the same work", () => {
		expect(overflowInstanceId(work)).toBe(overflowInstanceId({ ...work }));
	});

	it("stays within the instance-id charset", () => {
		expect(
			overflowInstanceId({ ...work, continuity: "group:7 tricky/id" }),
		).toMatch(/^overflow_[0-9a-f]+$/u);
	});

	it("distinguishes every field of the work tuple", () => {
		const ids = new Set([
			overflowInstanceId(work),
			overflowInstanceId({ ...work, baselineRevision: 4 }),
			overflowInstanceId({ ...work, continuity: "simkl:anime:43" }),
			overflowInstanceId({ ...work, targetService: "anilist" }),
		]);
		expect(ids.size).toBe(4);
	});
});
