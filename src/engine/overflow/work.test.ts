import { describe, expect, it } from "vitest";

import { groupCoverageKey } from "./coverage.ts";
import { overflowInstanceId } from "./work.ts";
import type { BuildWork } from "./work.ts";

const work: BuildWork = {
	baselineRevision: 3,
	continuity: groupCoverageKey(42),
	targetService: "mal",
};

describe("overflowInstanceId", () => {
	it("is deterministic for the same work", () => {
		expect(overflowInstanceId(work)).toBe(overflowInstanceId({ ...work }));
	});

	it("stays within the instance-id charset", () => {
		expect(
			overflowInstanceId({ ...work, continuity: groupCoverageKey(7) }),
		).toMatch(/^overflow_[0-9a-f]+$/u);
	});

	it("distinguishes every field of the work tuple", () => {
		const ids = new Set([
			overflowInstanceId(work),
			overflowInstanceId({ ...work, baselineRevision: 4 }),
			overflowInstanceId({ ...work, continuity: groupCoverageKey(43) }),
			overflowInstanceId({ ...work, targetService: "anilist" }),
		]);
		expect(ids.size).toBe(4);
	});
});
