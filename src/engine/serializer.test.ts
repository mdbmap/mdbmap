import { describe, expect, it } from "vitest";

import type { Identity, Service, TitleIdentity } from "./identity.ts";
import { parseId } from "./identity.ts";
import type {
	CompletionStatus,
	InstalmentAnswer,
	Link,
	MatchedLink,
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

// Narrow a mapping to a matched link, failing the test if it is not.
function expectMatched(link: Link | undefined): asserts link is MatchedLink {
	expect(link?.status).toBe("matched");
}

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
				status: "matched",
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
						status: "matched",
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
				status: "matched",
			},
		],
	]),
};

const noCounterpart = (status: CompletionStatus): InstalmentAnswer => ({
	input: episode(imdbTitle, 1, 1),
	kind: "instalment",
	links: new Map<Service, ResolvedLink>([["tmdb", { status }]]),
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
		const link = serialize(splitAnswer).mappings.tmdb;
		expectMatched(link);
		expect(link.confidence).toBe("high");
	});
});

describe("ADR canonical mapping", () => {
	// tmdb:603 -> tt0133093 at exact confidence, from ADR-0001's response example.
	const matrix: InstalmentAnswer = {
		input: { kind: "title", title: { id: "603", namespace: "movie", service: "tmdb" } },
		kind: "instalment",
		links: new Map<Service, ResolvedLink>([
			[
				"imdb",
				{
					counterparts: [
						{
							assertionPath: [{ confidence: "high", source: "community" }],
							confidence: "exact",
							identity: { kind: "title", title: { id: "tt0133093", service: "imdb" } },
						},
					],
					status: "matched",
				},
			],
		]),
	};

	it("maps tmdb:603 to tt0133093 at exact confidence", () => {
		const response = serialize(matrix);
		expect(response.input).toBe("tmdb:603");
		const link = response.mappings.imdb;
		expectMatched(link);
		expect(link.counterparts.map((counterpart) => counterpart.id)).toStrictEqual(["tt0133093"]);
		expect(link.confidence).toBe("exact");
	});

	it("propagates the exact grade to the compact response", () => {
		const compact = toCompact(serialize(matrix));
		expect(compact.confidence).toBe("exact");
		expect(compact.status).toBe("matched");
	});
});

describe("supporting instalment", () => {
	// A bare AniDB movie-collection title maps to an atomic TMDB film, naming the
	// collection instalment that backs it (ADR-0001).
	const collection: InstalmentAnswer = {
		input: { kind: "title", title: { id: "1400", service: "anilist" } },
		kind: "instalment",
		links: new Map<Service, ResolvedLink>([
			[
				"tmdb",
				{
					counterparts: [
						{
							assertionPath: [{ confidence: "high", source: "manual" }],
							confidence: "high",
							identity: { kind: "title", title: { id: "603", namespace: "movie", service: "tmdb" } },
							supportingInstalment: episode({ id: "1400", service: "anilist" }, 1, 2),
						},
					],
					status: "matched",
				},
			],
		]),
	};

	it("names the request-side instalment backing a title-level counterpart", () => {
		const link = serialize(collection).mappings.tmdb;
		expectMatched(link);
		expect(link.counterparts[0]?.id).toBe("tmdb:603");
		expect(link.counterparts[0]?.supportingInstalment).toBe("anilist:1400:2");
	});
});

describe("unrepresentable counterpart", () => {
	// A flat AniList spoke with season 2 cannot be a boundary id; the one bad
	// spoke becomes a per-link error and never aborts the response.
	const mixed: InstalmentAnswer = {
		input: episode(imdbTitle, 1, 1),
		kind: "instalment",
		links: new Map<Service, ResolvedLink>([
			[
				"anilist",
				{
					counterparts: [
						{
							assertionPath: [{ confidence: "high", source: "t3-episode" }],
							confidence: "high",
							identity: episode({ id: "1400", service: "anilist" }, 1, 3),
						},
						{
							assertionPath: [{ confidence: "low", source: "t2-pattern" }],
							confidence: "low",
							identity: episode({ id: "1400", service: "anilist" }, 2, 4),
						},
					],
					status: "matched",
				},
			],
		]),
	};

	it("keeps formattable spokes and surfaces the bad one as a link error", () => {
		const link = serialize(mixed).mappings.anilist;
		expectMatched(link);
		expect(link.counterparts.map((counterpart) => counterpart.id)).toStrictEqual(["anilist:1400:3"]);
		expect(link.errors).toHaveLength(1);
		expect(link.errors[0]?.reason).toContain("season 2");
	});
});

describe("request-side instalment guard", () => {
	// A title whose internal model includes a flat-service instalment numbered
	// season 2: that instalment has no boundary id, but must not abort the title's
	// other instalments or its top-level mappings.
	const flatTitle: TitleIdentity = { id: "1400", service: "anilist" };
	const answer: TitleAnswer = {
		groupSource: "manual",
		input: { kind: "title", title: flatTitle },
		instalments: [
			{
				input: episode(flatTitle, 1, 1),
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
							status: "matched",
						},
					],
				]),
				source: "t3-episode",
			},
			{
				input: episode(flatTitle, 2, 4),
				links: new Map<Service, ResolvedLink>([["imdb", { status: "unmatched" }]]),
				source: "release",
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
					status: "matched",
				},
			],
		]),
	};

	it("skips the unrepresentable instalment and keeps the rest of the response", () => {
		const response = serialize(answer);
		expect(response.instalments?.map((instalment) => instalment.input)).toStrictEqual([
			"anilist:1400:1",
		]);
		expect(response.instalmentErrors).toHaveLength(1);
		expect(response.instalmentErrors?.[0]?.reason).toContain("season 2");
		expect(response.instalmentErrors?.[0]?.source).toBe("release");
		expect(response.mappings.imdb?.status).toBe("matched");
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
		const link = serialize(titleAnswer).mappings.imdb;
		expectMatched(link);
		expect(link.source).toBe("manual");
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
						status: "matched",
					},
				],
			]),
		};
		const link = serialize(answer).mappings.tmdb;
		expectMatched(link);
		expect(link.source).toBe("manual");
	});
});

describe("no-counterpart status", () => {
	it("is known-no-counterpart when the search completed empty", () => {
		const link = serialize(noCounterpart("known-no-counterpart")).mappings.tmdb;
		expect(link?.status).toBe("known-no-counterpart");
		expect(link?.counterparts).toStrictEqual([]);
	});

	it("is unmatched when the ladder is incomplete", () => {
		expect(serialize(noCounterpart("unmatched")).mappings.tmdb?.status).toBe("unmatched");
	});

	it("surfaces pending and conflict targets", () => {
		expect(serialize(noCounterpart("pending")).mappings.tmdb?.status).toBe("pending");
		expect(serialize(noCounterpart("conflict")).mappings.tmdb?.status).toBe("conflict");
	});
});

describe("compact legacy shape", () => {
	it("strips evidence to bare counterpart ids", () => {
		const compact = toCompact(serialize(splitAnswer));
		expect(compact.mappings).toStrictEqual({ tmdb: ["tmdb:1396:2:5", "tmdb:1396:2:6"] });
		expect(compact.confidence).toBe("high");
		expect(compact.status).toBe("matched");
		expect(compact.source).toBe("t3-episode");
	});

	it("keeps the empty array and no confidence for a known no-counterpart", () => {
		const compact = toCompact(serialize(noCounterpart("known-no-counterpart")));
		expect(compact.mappings).toStrictEqual({ tmdb: [] });
		expect(compact.confidence).toBeUndefined();
		expect(compact.status).toBe("known-no-counterpart");
	});

	it("omits a pending target so [] stays reserved for known no-counterpart", () => {
		const mixed: InstalmentAnswer = {
			input: episode(imdbTitle, 1, 1),
			kind: "instalment",
			links: new Map<Service, ResolvedLink>([
				[
					"tmdb",
					{
						counterparts: [
							{
								assertionPath: [{ confidence: "high", source: "community" }],
								confidence: "exact",
								identity: { kind: "title", title: { id: "603", namespace: "movie", service: "tmdb" } },
							},
						],
						status: "matched",
					},
				],
				["anilist", { status: "pending" }],
			]),
		};
		const compact = toCompact(serialize(mixed));
		expect(compact.status).toBe("matched");
		expect(compact.mappings).toStrictEqual({ tmdb: ["tmdb:603"] });
		expect("anilist" in compact.mappings).toBe(false);
	});
});

describe("compact aggregate excludes non-emittable links", () => {
	// A single matched target whose one spoke is a flat-service instalment with a
	// season number: formatId rejects it, so counterparts is empty and errors holds
	// the failure. Nothing else backs the aggregate, so it must not compact to a
	// success-shaped matched/exact triple with empty mappings.
	const allSpokesErrored: InstalmentAnswer = {
		input: episode(imdbTitle, 1, 1),
		kind: "instalment",
		links: new Map<Service, ResolvedLink>([
			[
				"anilist",
				{
					counterparts: [
						{
							assertionPath: [{ confidence: "high", source: "t3-episode" }],
							confidence: "exact",
							identity: episode({ id: "1400", service: "anilist" }, 2, 4),
						},
					],
					status: "matched",
				},
			],
		]),
	};

	it("never reads as a success when the only target's spokes all fail to format", () => {
		const compact = toCompact(serialize(allSpokesErrored));
		expect(compact.mappings).toStrictEqual({});
		expect(compact.confidence).toBeUndefined();
		expect(compact.status).toBe("unmatched");
	});
});
