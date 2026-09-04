import { describe, expect, it } from "vitest";

import { mapScore, mapWatchStatus } from "./scale.ts";

describe("sync-push scale", () => {
	it("maps watch statuses onto the shared outbound vocabulary", () => {
		expect(mapWatchStatus("watching")).toBe("current");
		expect(mapWatchStatus("on_hold")).toBe("on_hold");
		expect(mapWatchStatus("completed")).toBe("completed");
		expect(mapWatchStatus("dropped")).toBe("dropped");
		expect(mapWatchStatus("rewatching")).toBe("repeating");
	});

	it("scales AniList scores to 0–100 and leaves others on 1–10", () => {
		expect(mapScore("anilist", 8)).toBe(80);
		expect(mapScore("mal", 8)).toBe(8);
		expect(mapScore("trakt", 8)).toBe(8);
		expect(mapScore("simkl", 8)).toBe(8);
	});
});
