import { describe, expect, it } from "vitest";

import { malStatusToWatchStatus, proposedScoreOf } from "./map-status.ts";

describe("malStatusToWatchStatus", () => {
	it("maps MAL list statuses onto WatchStatus", () => {
		expect(malStatusToWatchStatus("watching")).toBe("watching");
		expect(malStatusToWatchStatus("completed")).toBe("completed");
		expect(malStatusToWatchStatus("on_hold")).toBe("on_hold");
		expect(malStatusToWatchStatus("dropped")).toBe("dropped");
		expect(malStatusToWatchStatus("rewatching")).toBe("rewatching");
		expect(malStatusToWatchStatus("plan_to_watch")).toBeUndefined();
		expect(malStatusToWatchStatus("unknown")).toBeUndefined();
	});
});

describe("proposedScoreOf", () => {
	it("drops non-positive scores", () => {
		expect(proposedScoreOf(undefined)).toBeUndefined();
		expect(proposedScoreOf(0)).toBeUndefined();
		expect(proposedScoreOf(8)).toBe(8);
	});
});
