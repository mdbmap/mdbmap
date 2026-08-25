import { describe, expect, it } from "vitest";

import type { MemberTitles } from "@/engine";
import type { RateableUnit } from "@/orpc/schema";

import { serviceRatingsProvider } from "./service-ratings.ts";

// The first-cour member ids the engine resolves for Spy × Family.
const members: MemberTitles = {
	anidb: "16947",
	anilist: "140960",
	mal: "50265",
	tmdb: "120089",
};

const part: RateableUnit = { key: "part:group:1:0", kind: "part" };

describe("service ratings list", () => {
	it("returns a per-service list, each in its native scale, never merged", async () => {
		const ratings = await serviceRatingsProvider.ratingsFor(part, members);

		expect(ratings.length).toBeGreaterThan(1);
		expect(new Set(ratings.map((rating) => rating.service)).size).toBe(
			ratings.length,
		);
		for (const rating of ratings) {
			expect(rating.votes).toBeGreaterThan(0);
			expect(rating.score).toBeGreaterThan(0);
			expect(rating.scale).toBeGreaterThan(0);
			expect(rating.score).toBeLessThanOrEqual(rating.scale);
		}
		// AniList publishes /100 while MAL publishes /10; distinct scales prove the
		// list is kept native rather than folded onto a shared denominator.
		expect(new Set(ratings.map((rating) => rating.scale))).toEqual(
			new Set([10, 100]),
		);
	});

	it("maps every resolved member id to its own service entry", async () => {
		const ratings = await serviceRatingsProvider.ratingsFor(part, members);

		expect(new Set(ratings.map((rating) => rating.service))).toEqual(
			new Set(Object.keys(members)),
		);
		const anilist = ratings.find((rating) => rating.service === "anilist");
		expect(anilist).toEqual({
			scale: 100,
			score: 86,
			service: "anilist",
			votes: 214_500,
		});
	});

	it("orders the list deterministically", async () => {
		const ratings = await serviceRatingsProvider.ratingsFor(part, members);

		expect(ratings.map((rating) => rating.service)).toEqual([
			"tmdb",
			"mal",
			"anilist",
			"anidb",
		]);
	});

	it("yields no ratings for units that are not parts", async () => {
		const episode: RateableUnit = { key: "anidb:16947#1", kind: "episode" };
		const work: RateableUnit = { key: "continuity:spy-x-family", kind: "work" };

		expect(await serviceRatingsProvider.ratingsFor(episode, members)).toEqual([]);
		expect(await serviceRatingsProvider.ratingsFor(work, members)).toEqual([]);
	});
});
