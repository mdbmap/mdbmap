import { describe, expect, it } from "vitest";

import type { Identity, Service, TitleIdentity } from "./identity.ts";
import { parseId } from "./identity.ts";
import type {
	InstalmentAnswer,
	ResolvedLink,
	TitleAnswer,
} from "./serializer.ts";
import { serialize, toCompact } from "./serializer.ts";

const gameOfThrones: TitleIdentity = { id: "1399", namespace: "tv", service: "tmdb" };
const imdbTitle: TitleIdentity = { id: "tt0944947", service: "imdb" };

const episode = (title: TitleIdentity, season: number, ep: number): Identity => ({
	kind: "instalment",
	locator: { episode: ep, season },
	title,
});

// A shared content unit split across two TMDB episodes on one AniDB-style spoke.
const splitAnswer: InstalmentAnswer = {
	input: episode({ id: "tt0903747", service: "imdb" }, 2, 5),
	kind: "instalment",
	links: new Map<Service, ResolvedLink>([
		[
			"tmdb",
			{
				counterparts: [
					{
						assertionPath: [{ confidence: "high", source: "t3-episode" }],
						confidence: "high",
						identity: episode({ id: "1396", namespace: "tv", service: "tmdb" }, 2, 5),
					},
					{
						assertionPath: [{ confidence: "low", source: "t2-pattern" }],
						confidence: "low",
						identity: episode({ id: "1396", namespace: "tv", service: "tmdb" }, 2, 6),
					},
				],
				linked: true,
			},
		],
	]),
};

const titleAnswer: TitleAnswer = {
	groupSource: "manual",
	input: { kind: "title", title: gameOfThrones },
	instalments: [
		{
			input: episode(gameOfThrones, 1, 1),
			links: new Map<Service, ResolvedLink>([
				[
					"imdb",
					{
						counterparts: [
							{
								assertionPath: [{ confidence: "high", source: "t3-episode" }],
								confidence: "exact",
								identity: episode(imdbTitle, 1, 1),
							},
						],
						linked: true,
					},
				],
			]),
			source: "t3-episode",
		},
	],
	kind: "title",
	links: new Map<Service, ResolvedLink>([
		[
			"imdb",
			{
				counterparts: [
					{
						assertionPath: [{ confidence: "high", source: "community" }],
						confidence: "exact",
						identity: { kind: "title", title: imdbTitle },
					},
				],
				linked: true,
			},
		],
	]),
};

const unlinked = (ladderComplete: boolean): InstalmentAnswer => ({
	input: episode(imdbTitle, 1, 1),
	kind: "instalment",
	links: new Map<Service, ResolvedLink>([["tmdb", { ladderComplete, linked: false }]]),
});

describe("split/merge instalments", () => {
	it("serialises every counterpart spoke as an array of valid input ids", () => {
		const link = serialize(splitAnswer).mappings.tmdb;
		expect(link?.counterparts.map((counterpart) => counterpart.id)).toStrictEqual([
			"tmdb:1396:2:5",
			"tmdb:1396:2:6",
		]);
		for (const counterpart of link?.counterparts ?? []) {
			expect(parseId("series", counterpart.id).ok).toBe(true);
		}
	});

	it("grades the link by its strongest counterpart", () => {
		expect(serialize(splitAnswer).mappings.tmdb?.confidence).toBe("high");
	});
});

describe("title vs instalment level", () => {
	it("a title-level answer carries its instalments array", () => {
		const response = serialize(titleAnswer);
		expect(response.instalments?.map((instalment) => instalment.input)).toStrictEqual([
			"tmdb:1399:1:1",
		]);
		expect(response.instalments?.[0]?.mappings.imdb?.counterparts[0]?.id).toBe("tt0944947:1:1");
	});

	it("an instalment-level answer omits the instalments array", () => {
		expect("instalments" in serialize(splitAnswer)).toBe(false);
	});
});

describe("source precedence", () => {
	it("a title-level link serves the derived group source over the path's own", () => {
		expect(serialize(titleAnswer).mappings.imdb?.source).toBe("manual");
	});

	it("an instalment-level link serves the most-curated source on its own path", () => {
		const answer: InstalmentAnswer = {
			input: episode(imdbTitle, 1, 1),
			kind: "instalment",
			links: new Map<Service, ResolvedLink>([
				[
					"tmdb",
					{
						counterparts: [
							{
								assertionPath: [
									{ confidence: "low", source: "t1-structure" },
									{ confidence: "high", source: "manual" },
									{ confidence: "high", source: "community" },
								],
								confidence: "high",
								identity: episode({ id: "1396", namespace: "tv", service: "tmdb" }, 1, 1),
							},
						],
						linked: true,
					},
				],
			]),
		};
		expect(serialize(answer).mappings.tmdb?.source).toBe("manual");
	});
});

describe("no-counterpart grade", () => {
	it("is none when the ladder is complete", () => {
		const link = serialize(unlinked(true)).mappings.tmdb;
		expect(link?.confidence).toBe("none");
		expect(link?.counterparts).toStrictEqual([]);
	});

	it("is unmatched when the ladder is incomplete", () => {
		expect(serialize(unlinked(false)).mappings.tmdb?.confidence).toBe("unmatched");
	});
});

describe("compact legacy shape", () => {
	it("strips evidence to bare counterpart ids", () => {
		const compact = toCompact(serialize(splitAnswer));
		expect(compact.mappings).toStrictEqual({ tmdb: ["tmdb:1396:2:5", "tmdb:1396:2:6"] });
		expect(compact.confidence).toBe("high");
		expect(compact.source).toBe("t3-episode");
	});

	it("keeps the empty array for a known no-counterpart", () => {
		const compact = toCompact(serialize(unlinked(true)));
		expect(compact.mappings).toStrictEqual({ tmdb: [] });
		expect(compact.confidence).toBe("none");
	});
});
