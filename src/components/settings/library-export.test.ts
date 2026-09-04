import { describe, expect, it } from "vitest";

import type { LibraryEntry } from "@/orpc/schema";

import { libraryExportJson } from "./library-export";

const exportedAt = "2026-09-04T13:00:00.000Z";

const entry = (overrides: Partial<LibraryEntry> = {}): LibraryEntry => ({
	continuityId: "continuity:12",
	coverRef: undefined,
	personalRating: 8,
	rewatchCount: 1,
	status: "watching",
	title: "Spy × Family",
	totalInstalments: 37,
	watchedInstalments: 25,
	...overrides,
});

describe("libraryExportJson", () => {
	it("serialises tracked works with a version stamp", () => {
		const json = libraryExportJson([entry()], exportedAt);
		expect(JSON.parse(json)).toEqual({
			exportedAt,
			version: 1,
			works: [entry()],
		});
		expect(json.endsWith("\n")).toBe(true);
	});

	it("serialises an empty library", () => {
		expect(JSON.parse(libraryExportJson([], exportedAt))).toEqual({
			exportedAt,
			version: 1,
			works: [],
		});
	});
});
