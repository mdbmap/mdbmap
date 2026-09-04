import { describe, expect, it } from "vitest";

import { airingDays } from "./airing.ts";
import type { AiringDay, AiringEpisode, AiringWork } from "./airing.ts";

const strix: AiringEpisode = {
	airDate: "2026-04-09",
	continuityId: "continuity:12",
	number: 1,
	partLabel: "Cour 1",
	title: "Operation Strix",
	workTitle: "Spy × Family",
};
const wife: AiringEpisode = {
	airDate: "2026-04-16",
	continuityId: "continuity:12",
	number: 2,
	partLabel: "Cour 1",
	title: "Secure a Wife",
	workTitle: "Spy × Family",
};
const dawn: AiringEpisode = {
	airDate: "2026-04-11",
	continuityId: "continuity:7",
	number: 1,
	partLabel: "Dawn",
	title: "Dawn",
	workTitle: "Made in Abyss",
};

const spyWork = (overrides: Partial<AiringWork> = {}): AiringWork => ({
	continuityId: "continuity:12",
	segments: [
		{
			airedFrom: "2026-04-09",
			episodes: [
				{ airDate: "2026-04-09", number: 1, title: "Operation Strix" },
				{ airDate: "2026-04-16", number: 2, title: "Secure a Wife" },
			],
			instalments: ["ep:1", "ep:2"],
			kind: "episodic",
			label: "Cour 1",
		},
	],
	title: "Spy × Family",
	watched: new Set(),
	...overrides,
});

const dawnWork: AiringWork = {
	continuityId: "continuity:7",
	segments: [
		{
			airedFrom: "2026-04-11",
			episodes: [],
			instalments: ["film:1"],
			kind: "atomic",
			label: "Dawn",
		},
	],
	title: "Made in Abyss",
	watched: new Set(),
};

const day = (date: string, episodes: AiringEpisode[]): AiringDay => ({
	date,
	episodes,
});

describe("airingDays window", () => {
	it("groups unwatched instalments inside the window by air date", () => {
		const days = airingDays([spyWork()], "2026-04-09", "2026-04-16");
		expect(days).toEqual([
			day("2026-04-09", [strix]),
			day("2026-04-16", [wife]),
		]);
	});
});

describe("airingDays filters", () => {
	it("omits watched instalments and dates outside the window", () => {
		const tracked = spyWork({ watched: new Set(["ep:1"]) });
		const days = airingDays([tracked], "2026-04-10", "2026-04-20");
		expect(days).toEqual([day("2026-04-16", [wife])]);
	});
});

describe("airingDays films", () => {
	it("uses airedFrom for an unwatched atomic film", () => {
		const days = airingDays([dawnWork], "2026-04-09", "2026-04-16");
		expect(days).toEqual([day("2026-04-11", [dawn])]);
	});

	it("falls back to Film when the atomic segment label is empty", () => {
		const unlabeled: AiringWork = {
			continuityId: "continuity:7",
			segments: [
				{
					airedFrom: "2026-04-11",
					episodes: [],
					instalments: ["film:1"],
					kind: "atomic",
					label: "",
				},
			],
			title: "Made in Abyss",
			watched: new Set(),
		};
		const days = airingDays([unlabeled], "2026-04-09", "2026-04-16");
		expect(days).toEqual([
			day("2026-04-11", [{ ...dawn, partLabel: "Film", title: "Film" }]),
		]);
	});
});
