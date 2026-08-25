import { describe, expect, it } from "vitest";

import type { EpisodeView, WorkView } from "@/orpc/schema";

import { applyDerivedTracking, applyEpisodeWatched } from "./optimistic";

const emptyScore = { count: 0, mean: undefined };

const episode = (number: number, watched: boolean): EpisodeView => ({
	airDate: undefined,
	communityScore: emptyScore,
	instalmentLocator: `ep:${number}`,
	number,
	personalRating: undefined,
	rateableUnit: { key: `episode:${number}`, kind: "episode" },
	title: `Episode ${number}`,
	watched,
});

const work = (): WorkView => ({
	cast: [],
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
		{
			airedFrom: undefined,
			airedTo: undefined,
			communityScore: emptyScore,
			episodeCount: 2,
			episodes: [episode(1, false), episode(2, false)],
			label: "Part 1",
			personalRating: undefined,
			rateableUnit: { key: "part:1", kind: "part" },
			serviceRatings: [],
			year: 2022,
		},
	],
	staff: [],
	studios: [],
	viewer: undefined,
});

describe("applyEpisodeWatched", () => {
	it("flips the row and adds the locator to the viewer's watched set", () => {
		const next = applyEpisodeWatched(work(), "ep:1", true);
		expect(next.parts[0]?.episodes[0]?.watched).toBe(true);
		expect(next.viewer?.watched).toContain("ep:1");
		// The You block reads this length as progress.
		expect(next.viewer?.watched).toHaveLength(1);
		expect(next.viewer?.status).toBe("watching");
	});

	it("clears the row and drops the locator when unwatched", () => {
		const marked = applyEpisodeWatched(work(), "ep:1", true);
		const cleared = applyEpisodeWatched(marked, "ep:1", false);
		expect(cleared.parts[0]?.episodes[0]?.watched).toBe(false);
		expect(cleared.viewer?.watched).toHaveLength(0);
	});

	it("does not mutate the input", () => {
		const input = work();
		applyEpisodeWatched(input, "ep:1", true);
		expect(input.parts[0]?.episodes[0]?.watched).toBe(false);
		expect(input.viewer).toBeUndefined();
	});
});

describe("applyDerivedTracking", () => {
	it("mirrors the server's derived status and watched set", () => {
		const next = applyDerivedTracking(work(), {
			status: "completed",
			watched: ["ep:1", "ep:2"],
		});
		expect(next.viewer?.status).toBe("completed");
		expect(next.parts[0]?.episodes.every((item) => item.watched)).toBe(true);
	});
});
