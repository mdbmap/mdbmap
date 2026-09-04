import { describe, expect, it } from "vitest";

import type { ResolveResult } from "@/engine";

import { mapContinuity } from "./map-continuity.ts";

const resolved: ResolveResult = {
	continuityId: "continuity:1",
	mediaKind: "anime",
	segments: [
		{
			instalments: ["anidb:1#1", "anidb:1#2"],
			kind: "episodic",
			members: { anilist: "100", mal: "200" },
		},
		{
			instalments: ["anidb:2#1"],
			kind: "episodic",
			members: { anilist: "101" },
		},
	],
};

describe("mapContinuity", () => {
	it("fans completed status and progress out to mapped titles only", () => {
		const result = mapContinuity({
			continuityId: "continuity:1",
			providers: ["anilist", "mal", "trakt"],
			resolved,
			tracking: {
				episodeWatched: new Set(["anidb:1#1", "anidb:2#1", "orphan:9#1"]),
				ratings: [
					{ score: 9, unitKey: "continuity:1", unitKind: "work" },
					{ score: 7, unitKey: "part:continuity:1:0", unitKind: "part" },
					{ score: 6, unitKey: "anidb:1#1", unitKind: "episode" },
				],
				status: "completed",
			},
		});

		const anilist = result.targets.find(
			(target) => target.provider === "anilist",
		);
		const mal = result.targets.find((target) => target.provider === "mal");
		const trakt = result.targets.find((target) => target.provider === "trakt");

		expect(anilist?.batch.status).toEqual([
			{ externalTitleId: "100", status: "completed" },
			{ externalTitleId: "101", status: "completed" },
		]);
		expect(anilist?.batch.progress).toEqual([
			{ episode: 1, externalTitleId: "100", watched: true },
			{ episode: 1, externalTitleId: "101", watched: true },
		]);
		expect(anilist?.batch.ratings).toEqual([
			{
				episode: 1,
				externalTitleId: "100",
				score: 60,
				unit: "episode",
			},
			{ externalTitleId: "100", score: 70, unit: "title" },
			{ externalTitleId: "100", score: 90, unit: "title" },
		]);

		expect(mal?.batch.status).toEqual([
			{ externalTitleId: "200", status: "completed" },
		]);
		expect(mal?.batch.progress).toEqual([
			{ episode: 1, externalTitleId: "200", watched: true },
		]);
		expect(mal?.batch.ratings).toEqual([
			{ episode: 1, externalTitleId: "200", score: 6, unit: "episode" },
			{ externalTitleId: "200", score: 7, unit: "title" },
			{ externalTitleId: "200", score: 9, unit: "title" },
		]);

		expect(trakt).toBeUndefined();
		expect(
			result.warnings.some(
				(warning) =>
					warning.provider === "trakt" &&
					warning.reason === "unsupported_provider_mapping",
			),
		).toBe(true);
		expect(
			result.warnings.some(
				(warning) =>
					warning.provider === "mal" &&
					warning.segmentIndex === 1 &&
					warning.reason === "no_member_title",
			),
		).toBe(true);
		expect(
			result.warnings.some(
				(warning) =>
					warning.kind === "instalment" &&
					warning.instalmentLocator === "orphan:9#1" &&
					warning.reason === "unmapped_instalment",
			),
		).toBe(true);
	});
});
