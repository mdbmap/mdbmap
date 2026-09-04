import { describe, expect, it } from "vitest";

import type { EpisodeView, FilmView, PartView, WorkView } from "@/orpc/schema";

import { applyRating, applyRewatch, applyStatus } from "./optimistic";

const emptyScore = { count: 0, mean: undefined };

const episode = (
	locator: string,
	overrides: Partial<EpisodeView> = {},
): EpisodeView => ({
	airDate: "2022-04-09",
	communityScore: emptyScore,
	instalmentLocator: locator,
	number: 1,
	personalRating: undefined,
	rateableUnit: { key: locator, kind: "episode" },
	title: "Operation Strix",
	watched: false,
	...overrides,
});

const part = (key: string, episodes: EpisodeView[] = []): PartView => ({
	airedFrom: undefined,
	airedTo: undefined,
	communityScore: emptyScore,
	episodeCount: Math.max(episodes.length, 1),
	episodes,
	kind: "part",
	label: "Part 1",
	personalRating: undefined,
	rateableUnit: { key, kind: "part" },
	serviceRatings: [],
	year: 2022,
});

const film = (locator: string): FilmView => ({
	airDate: "2020-01-17",
	airedFrom: "2020-01-17",
	airedTo: "2020-01-17",
	communityScore: emptyScore,
	episodeCount: 0,
	episodes: [],
	instalmentLocator: locator,
	kind: "film",
	label: "Dawn",
	personalRating: undefined,
	rateableUnit: { key: locator, kind: "movie" },
	serviceRatings: [],
	watched: false,
	year: 2020,
});

const work = (): WorkView => ({
	cast: [],
	communityScore: emptyScore,
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
	parts: [
		part("part:continuity:x:0", [
			episode("anidb:1#1"),
			episode("anidb:1#2", { number: 2, title: "Secure Location" }),
		]),
		film("anidb:film#1"),
	],
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

	it("writes an episode score onto the matching episode only", () => {
		const next = applyRating(work(), { key: "anidb:1#2", kind: "episode" }, 7);
		const [cour] = next.parts;
		expect(cour?.kind === "part" ? cour.episodes[0]?.personalRating : 0).toBe(
			undefined,
		);
		expect(cour?.kind === "part" ? cour.episodes[1]?.personalRating : 0).toBe(
			7,
		);
		expect(cour?.personalRating).toBeUndefined();
	});

	it("clears an episode score when the score is undefined", () => {
		const rated = applyRating(work(), { key: "anidb:1#1", kind: "episode" }, 6);
		const cleared = applyRating(
			rated,
			{ key: "anidb:1#1", kind: "episode" },
			undefined,
		);
		const [cour] = cleared.parts;
		expect(cour?.kind === "part" ? cour.episodes[0]?.personalRating : 0).toBe(
			undefined,
		);
	});

	it("writes a movie score onto the matching film block", () => {
		const next = applyRating(work(), { key: "anidb:film#1", kind: "movie" }, 8);
		const [, block] = next.parts;
		expect(block?.kind === "film" ? block.personalRating : undefined).toBe(8);
		expect(next.parts[0]?.personalRating).toBeUndefined();
	});
});
