import { describe, expect, it } from "vitest";

import type { PartView, WorkView } from "@/orpc/schema";

import { applyRating, applyRewatch, applyStatus } from "./optimistic";

const emptyScore = { count: 0, mean: undefined };

const part = (key: string): PartView => ({
	airedFrom: undefined,
	airedTo: undefined,
	communityScore: emptyScore,
	episodeCount: 1,
	episodes: [],
	kind: "part",
	label: "Part 1",
	personalRating: undefined,
	rateableUnit: { key, kind: "part" },
	serviceRatings: [],
	year: 2022,
});

const work = (): WorkView => ({
	cast: [],
	catalogues: [],
	continuityId: "continuity:x",
	header: {
		backdropRef: undefined,
		coverRef: undefined,
		nativeTitle: undefined,
		span: "2022",
		synopsis: "",
		title: "X",
	},
	ifYouLiked: [],
	mediaKind: "anime",
	parts: [part("part:continuity:x:0")],
	staff: [],
	studios: [],
	viewer: undefined,
});

describe("applyStatus", () => {
	it("sets the viewer status, seeding a viewer when absent", () => {
		const next = applyStatus(work(), "completed");
		expect(next.viewer?.status).toBe("completed");
		expect(next.viewer?.rewatchCount).toBe(0);
	});

	it("does not mutate the input", () => {
		const input = work();
		applyStatus(input, "dropped");
		expect(input.viewer).toBeUndefined();
	});
});

describe("applyRewatch", () => {
	it("sets the rewatch count", () => {
		const next = applyRewatch(work(), 3);
		expect(next.viewer?.rewatchCount).toBe(3);
	});
});

describe("applyRating", () => {
	it("writes a work score onto the viewer", () => {
		const next = applyRating(work(), { key: "continuity:x", kind: "work" }, 8);
		expect(next.viewer?.personalRating).toBe(8);
		expect(next.parts[0]?.personalRating).toBeUndefined();
	});

	it("clears a work score when the score is undefined", () => {
		const rated = applyRating(work(), { key: "continuity:x", kind: "work" }, 8);
		const cleared = applyRating(
			rated,
			{ key: "continuity:x", kind: "work" },
			undefined,
		);
		expect(cleared.viewer?.personalRating).toBeUndefined();
	});

	it("writes a part score onto the matching part only", () => {
		const next = applyRating(
			work(),
			{ key: "part:continuity:x:0", kind: "part" },
			9,
		);
		expect(next.parts[0]?.personalRating).toBe(9);
		expect(next.viewer?.personalRating).toBeUndefined();
	});

	it("leaves parts untouched when no unit key matches", () => {
		const next = applyRating(work(), { key: "part:missing", kind: "part" }, 9);
		expect(next.parts[0]?.personalRating).toBeUndefined();
	});
});
