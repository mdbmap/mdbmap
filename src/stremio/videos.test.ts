import { describe, expect, it } from "vitest";

import type { Identity, Service, TitleIdentity } from "@/engine/identity.ts";
import { serialize } from "@/engine/serializer.ts";
import type {
	InstalmentAnswer,
	ResolvedLink,
	TitleAnswer,
} from "@/engine/serializer.ts";

import { imdbTitleIdFromMapping, videosFromMapping } from "./videos.ts";

const tmdbTv: TitleIdentity = {
	id: "1396",
	namespace: "tv",
	service: "tmdb",
};
const imdbTitle: TitleIdentity = { id: "tt0903747", service: "imdb" };

const episode = (
	title: TitleIdentity,
	season: number,
	ep: number,
): Identity => ({
	kind: "instalment",
	locator: { episode: ep, season },
	title,
});

const matchedImdb = (identity: Identity): ResolvedLink => ({
	counterparts: [
		{
			assertionPath: [{ confidence: "high", source: "t3-episode" }],
			confidence: "exact",
			identity,
		},
	],
	status: "matched",
});

describe("videosFromMapping series", () => {
	it("uses IMDb instalment ids as video ids", () => {
		const answer: TitleAnswer = {
			groupSource: "t1-structure",
			input: { kind: "title", title: tmdbTv },
			instalments: [
				{
					input: episode(tmdbTv, 1, 1),
					links: new Map<Service, ResolvedLink>([
						["imdb", matchedImdb(episode(imdbTitle, 1, 1))],
					]),
					source: "t3-episode",
				},
				{
					input: episode(tmdbTv, 1, 2),
					links: new Map<Service, ResolvedLink>([
						["imdb", matchedImdb(episode(imdbTitle, 1, 2))],
					]),
					source: "t3-episode",
				},
			],
			kind: "title",
			links: new Map<Service, ResolvedLink>([
				["imdb", matchedImdb({ kind: "title", title: imdbTitle })],
			]),
		};
		expect(
			videosFromMapping(serialize(answer)).map((video) => video.id),
		).toEqual(["tt0903747:1:1", "tt0903747:1:2"]);
		expect(imdbTitleIdFromMapping(serialize(answer))).toBe("tt0903747");
	});

	it("skips instalments without an IMDb counterpart", () => {
		const answer: TitleAnswer = {
			groupSource: "t1-structure",
			input: { kind: "title", title: tmdbTv },
			instalments: [
				{
					input: episode(tmdbTv, 1, 1),
					links: new Map<Service, ResolvedLink>([
						["imdb", matchedImdb(episode(imdbTitle, 1, 1))],
					]),
					source: "t3-episode",
				},
				{
					input: episode(tmdbTv, 1, 2),
					links: new Map<Service, ResolvedLink>(),
					source: "t1-structure",
				},
			],
			kind: "title",
			links: new Map(),
		};
		expect(
			videosFromMapping(serialize(answer)).map((video) => video.id),
		).toEqual(["tt0903747:1:1"]);
		expect(imdbTitleIdFromMapping(serialize(answer))).toBe("tt0903747");
	});

	it("uses requested IMDb instalment ids when counterparts omit IMDb", () => {
		const answer: TitleAnswer = {
			groupSource: "t1-structure",
			input: { kind: "title", title: imdbTitle },
			instalments: [
				{
					input: episode(imdbTitle, 1, 1),
					links: new Map(),
					source: "t3-episode",
				},
				{
					input: episode(imdbTitle, 1, 2),
					links: new Map(),
					source: "t3-episode",
				},
			],
			kind: "title",
			links: new Map(),
		};
		const serialized = serialize(answer);
		expect(videosFromMapping(serialized).map((video) => video.id)).toEqual([
			"tt0903747:1:1",
			"tt0903747:1:2",
		]);
		expect(imdbTitleIdFromMapping(serialized)).toBe("tt0903747");
	});
});

describe("videosFromMapping movies", () => {
	it("uses the IMDb title id for an atomic movie", () => {
		const answer: InstalmentAnswer = {
			input: {
				kind: "title",
				title: { id: "603", namespace: "movie", service: "tmdb" },
			},
			kind: "instalment",
			links: new Map<Service, ResolvedLink>([
				[
					"imdb",
					matchedImdb({
						kind: "title",
						title: { id: "tt0133093", service: "imdb" },
					}),
				],
			]),
		};
		const [video] = videosFromMapping(serialize(answer));
		expect(video?.id).toBe("tt0133093");
		expect(video?.season).toBe(0);
		expect(video?.episode).toBe(0);
		expect(imdbTitleIdFromMapping(serialize(answer))).toBe("tt0133093");
	});

	it("uses the requested IMDb title when the lookup is already IMDb", () => {
		const answer: InstalmentAnswer = {
			input: {
				kind: "title",
				title: { id: "tt0133093", service: "imdb" },
			},
			kind: "instalment",
			links: new Map(),
		};
		const [video] = videosFromMapping(serialize(answer));
		expect(video?.id).toBe("tt0133093");
	});
});
