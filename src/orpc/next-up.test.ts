import { describe, expect, it } from "vitest";

import { nextUp } from "./next-up.ts";

const watching = "watching" as const;

describe("nextUp first unwatched", () => {
	it("returns the first unwatched instalment", () => {
		expect(
			nextUp(
				watching,
				[
					{
						episodes: [
							{ number: 1, title: "Operation Strix" },
							{ number: 2, title: "Secure a Wife" },
						],
						instalments: ["c1e1", "c1e2"],
						kind: "episodic",
						label: "Cour 1",
					},
				],
				new Set(),
			),
		).toEqual({
			number: 1,
			partLabel: "Cour 1",
			title: "Operation Strix",
		});
	});
});

describe("nextUp skips watched", () => {
	it("skips watched instalments across parts", () => {
		expect(
			nextUp(
				watching,
				[
					{
						episodes: [{ number: 12, title: "WISE" }],
						instalments: ["c1e12"],
						kind: "episodic",
						label: "Cour 1",
					},
					{
						episodes: [
							{ number: 1, title: "Follow the Laughing Fish" },
							{ number: 3, title: "The Informal" },
						],
						instalments: ["c2e1", "c2e3"],
						kind: "episodic",
						label: "Cour 2",
					},
				],
				new Set(["c1e12", "c2e1"]),
			),
		).toEqual({
			number: 3,
			partLabel: "Cour 2",
			title: "The Informal",
		});
	});
});

describe("nextUp complete", () => {
	it("returns nothing when the work is completed", () => {
		expect(
			nextUp(
				"completed",
				[
					{
						instalments: ["c1e1"],
						kind: "episodic",
						label: "Cour 1",
					},
				],
				new Set(),
			),
		).toBeUndefined();
	});

	it("returns nothing when every instalment is watched", () => {
		expect(
			nextUp(
				watching,
				[
					{
						instalments: ["c1e1", "c1e2"],
						kind: "episodic",
					},
				],
				new Set(["c1e1", "c1e2"]),
			),
		).toBeUndefined();
	});
});

describe("nextUp film", () => {
	it("uses the film label as the title", () => {
		expect(
			nextUp(
				watching,
				[
					{
						instalments: ["tmdb:603#1"],
						kind: "atomic",
						label: "Dawn of the Deep Soul",
					},
				],
				new Set(),
			),
		).toEqual({
			number: 1,
			partLabel: "Film",
			title: "Dawn of the Deep Soul",
		});
	});
});

describe("nextUp fallbacks", () => {
	it("falls back to Episode n and Part i without metadata", () => {
		expect(
			nextUp(
				watching,
				[
					{
						instalments: ["a", "b"],
						kind: "episodic",
					},
				],
				new Set(["a"]),
			),
		).toEqual({
			number: 2,
			partLabel: "Part 1",
			title: "Episode 2",
		});
	});

	it("still returns the next instalment while rewatching", () => {
		expect(
			nextUp(
				"rewatching",
				[
					{
						episodes: [{ number: 1, title: "Operation Strix" }],
						instalments: ["c1e1"],
						kind: "episodic",
						label: "Cour 1",
					},
				],
				new Set(),
			),
		).toEqual({
			number: 1,
			partLabel: "Cour 1",
			title: "Operation Strix",
		});
	});
});
