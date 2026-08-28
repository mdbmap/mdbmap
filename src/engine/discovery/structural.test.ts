import { describe, expect, it, vi } from "vitest";

import type { InstalmentLocator } from "@/db/schema";
import { NotEnumerableServiceError } from "@/engine/ingest/not-enumerable.ts";
import type { FactsByLocator, InstalmentFacts } from "@/engine/matcher";
import { locator, regular, streamOf } from "@/engine/matcher/test-fixtures.ts";

import { discoverStructuralGroup } from "./structural.ts";
import type {
	DiscoveryClients,
	EnumeratedTitle,
	InstalmentsClient,
	MappedPair,
	ServiceRef,
} from "./structural.ts";

const factsOf = (
	entries: readonly (readonly [string, InstalmentFacts])[],
): FactsByLocator => {
	const map = new Map<InstalmentLocator, InstalmentFacts>();
	for (const [raw, fact] of entries) {
		map.set(locator(raw), fact);
	}
	return map;
};

const ref = (service: string, serviceId: string): ServiceRef => ({
	service,
	serviceId,
});

const SHARED = ref("imdb", "tt0495146");

// IMDb keeps Total Drama as one title carrying both seasons; TMDB splits it into
// a title per season. Season 1 aired in 2007, season 2 in 2008, so member order
// puts the 2007 title first however `/find` happened to list them.
const sharedTitle: EnumeratedTitle = {
	facts: factsOf([
		["imdb#1", { airDate: "2007-07-08", title: "Not So Happy Campers 1" }],
		["imdb#2", { airDate: "2007-07-15", title: "Not So Happy Campers 2" }],
		["imdb#3", { airDate: "2008-01-04", title: "The Big Sleep" }],
		["imdb#4", { airDate: "2008-01-11", title: "The Sucky Outdoors" }],
	]),
	stream: streamOf([
		regular("imdb#1"),
		regular("imdb#2"),
		regular("imdb#3"),
		regular("imdb#4"),
	]),
};

const seasonOne: EnumeratedTitle = {
	facts: factsOf([
		["tmdb-s1#1", { airDate: "2007-07-08", title: "Not So Happy Campers 1" }],
		["tmdb-s1#2", { airDate: "2007-07-15", title: "Not So Happy Campers 2" }],
	]),
	stream: streamOf([regular("tmdb-s1#1"), regular("tmdb-s1#2")]),
};

const seasonTwo: EnumeratedTitle = {
	facts: factsOf([
		["tmdb-s2#1", { airDate: "2008-01-04", title: "The Big Sleep" }],
		["tmdb-s2#2", { airDate: "2008-01-11", title: "The Sucky Outdoors" }],
	]),
	stream: streamOf([regular("tmdb-s2#1"), regular("tmdb-s2#2")]),
};

const emptyTitle: EnumeratedTitle = {
	facts: factsOf([]),
	stream: streamOf([]),
};

const S1_REF = ref("tmdb", "40733");
const S2_REF = ref("tmdb", "40734");
const DECOY_REF = ref("tmdb", "99999");

// `/find` lists season two before season one and includes a decoy whose ids name
// a different IMDb title. Ordering must ignore the list order, and the decoy must
// be excluded on its one-sided evidence.
const totalDramaClients = (
	enumerate: InstalmentsClient["enumerate"],
): DiscoveryClients => ({
	externalIds: {
		describe: (title) => {
			if (title.serviceId === SHARED.serviceId) {
				return { externalIds: [S1_REF, S2_REF], firstAirDate: "2007-07-08" };
			}
			if (title.serviceId === S1_REF.serviceId) {
				return { externalIds: [SHARED], firstAirDate: "2007-07-08" };
			}
			if (title.serviceId === S2_REF.serviceId) {
				return { externalIds: [SHARED], firstAirDate: "2008-01-04" };
			}
			return {
				externalIds: [ref("imdb", "tt-other")],
				firstAirDate: "2007-07-08",
			};
		},
	},
	find: {
		find: () => [S2_REF, DECOY_REF, S1_REF],
	},
	instalments: { enumerate },
});

const enumerateFor = (title: ServiceRef): EnumeratedTitle => {
	if (title.service === "imdb") {
		return sharedTitle;
	}
	if (title.serviceId === S1_REF.serviceId) {
		return seasonOne;
	}
	if (title.serviceId === S2_REF.serviceId) {
		return seasonTwo;
	}
	return emptyTitle;
};

const sortStrings = (values: readonly string[]): readonly string[] =>
	values.toSorted((first, second) => (first < second ? -1 : 1));

const pairKey = (pair: MappedPair): string =>
	`${sortStrings(pair.sharedLocators).join(",")}=>${sortStrings(pair.memberLocators).join(",")}`;

const pairKeys = (pairs: readonly MappedPair[]): readonly string[] =>
	sortStrings(pairs.map((pair) => pairKey(pair)));

describe("discoverStructuralGroup", () => {
	it("joins back-pointing candidates and maps each per member in date order (Total Drama)", async () => {
		const outcome = await discoverStructuralGroup({
			budget: 10,
			clients: totalDramaClients(enumerateFor),
			shared: SHARED,
		});

		expect(outcome.kind).toBe("discovered");
		if (outcome.kind !== "discovered") {
			return;
		}
		expect(outcome.mappings.map((mapping) => mapping.member)).toStrictEqual([
			S1_REF,
			S2_REF,
		]);
		// The anchor is a member too: it shares season one's 2007 date and, tying,
		// sorts by service id (imdb's "tt0495146" after tmdb's "40733"), so season
		// one takes ordinal 0 and the anchor 1 — the whole order is reproducible
		// from ordinals with no stored dates.
		expect(outcome.anchorOrdinal).toBe(1);
		expect(outcome.mappings.map((mapping) => mapping.ordinal)).toStrictEqual([
			0, 2,
		]);

		const [first, second] = outcome.mappings;
		expect(pairKeys(first?.pairs ?? [])).toStrictEqual([
			"imdb#1=>tmdb-s1#1",
			"imdb#2=>tmdb-s1#2",
		]);
		// The late member owns the late segment: season two maps over the shared
		// instalments season one left unclaimed, never the group's first.
		expect(pairKeys(second?.pairs ?? [])).toStrictEqual([
			"imdb#3=>tmdb-s2#1",
			"imdb#4=>tmdb-s2#2",
		]);
	});

	it("excludes a candidate whose external_ids do not point back", async () => {
		const outcome = await discoverStructuralGroup({
			budget: 10,
			clients: totalDramaClients(enumerateFor),
			shared: SHARED,
		});

		expect(outcome.kind).toBe("discovered");
		if (outcome.kind !== "discovered") {
			return;
		}
		const members = outcome.mappings.map((mapping) => mapping.member.serviceId);
		expect(members).not.toContain(DECOY_REF.serviceId);
	});

	it("refuses an over-budget group whole and writes nothing", async () => {
		// Shared title plus two members needs three fetches; a budget of two cannot
		// finish, so the group is refused before a single title is enumerated.
		const enumerate = vi.fn(enumerateFor);
		const outcome = await discoverStructuralGroup({
			budget: 2,
			clients: totalDramaClients(enumerate),
			shared: SHARED,
		});

		expect(outcome).toStrictEqual({ kind: "refused", reason: "over-budget" });
		expect(enumerate).not.toHaveBeenCalled();
	});

	it("refuses the whole group when a member cannot be mapped", async () => {
		// Season two's list came back truncated, so its alignment cannot publish.
		// A member that maps to nothing is a partial group, so the whole discovery
		// is refused rather than persisting season one alone.
		const truncatedTwo: EnumeratedTitle = {
			facts: seasonTwo.facts,
			stream: streamOf(
				[regular("tmdb-s2#1"), regular("tmdb-s2#2")],
				"truncated",
			),
		};
		const enumerate = (title: ServiceRef): EnumeratedTitle =>
			title.serviceId === S2_REF.serviceId ? truncatedTwo : enumerateFor(title);

		const outcome = await discoverStructuralGroup({
			budget: 10,
			clients: totalDramaClients(enumerate),
			shared: SHARED,
		});
		expect(outcome).toStrictEqual({
			kind: "refused",
			reason: "unmappable-member",
		});
	});

	it("orders a dateless member after every dated one", async () => {
		// A member whose live first-air date is absent sorts last whatever `/find`
		// order it arrived in, keeping the persisted ordinals deterministic.
		const undatedRef = ref("tvdb", "775");
		const undatedTitle: EnumeratedTitle = {
			facts: factsOf([["tvdb#1", { title: "Total Drama" }]]),
			stream: streamOf([regular("tvdb#1")]),
		};
		const clients: DiscoveryClients = {
			externalIds: {
				describe: (title) => {
					if (title.serviceId === SHARED.serviceId) {
						return { externalIds: [S1_REF], firstAirDate: "2007-07-08" };
					}
					if (title.serviceId === undatedRef.serviceId) {
						return { externalIds: [SHARED], firstAirDate: undefined };
					}
					return { externalIds: [SHARED], firstAirDate: "2007-07-08" };
				},
			},
			find: { find: () => [undatedRef, S1_REF] },
			instalments: {
				enumerate: (title) =>
					title.serviceId === undatedRef.serviceId
						? undatedTitle
						: enumerateFor(title),
			},
		};

		const outcome = await discoverStructuralGroup({
			budget: 10,
			clients,
			shared: SHARED,
		});
		expect(outcome.kind).toBe("discovered");
		if (outcome.kind !== "discovered") {
			return;
		}
		const last = outcome.mappings.at(-1);
		expect(last?.member).toStrictEqual(undatedRef);
	});

	it("reports no group when no candidate points back", async () => {
		const clients: DiscoveryClients = {
			externalIds: {
				describe: () => ({
					externalIds: [ref("imdb", "tt-other")],
					firstAirDate: "2007-07-08",
				}),
			},
			find: { find: () => [S1_REF] },
			instalments: { enumerate: enumerateFor },
		};

		const outcome = await discoverStructuralGroup({
			budget: 10,
			clients,
			shared: SHARED,
		});
		expect(outcome).toStrictEqual({ kind: "no-group" });
	});

	it("refuses when the shared title is not enumerable", async () => {
		const enumerate = async (title: ServiceRef): Promise<EnumeratedTitle> => {
			await Promise.resolve();
			if (title.service === SHARED.service) {
				throw new NotEnumerableServiceError(title.service);
			}
			return enumerateFor(title);
		};
		const outcome = await discoverStructuralGroup({
			budget: 10,
			clients: totalDramaClients(enumerate),
			shared: SHARED,
		});
		expect(outcome).toStrictEqual({
			kind: "refused",
			reason: "unmappable-member",
		});
	});

	it("refuses when a member title is not enumerable", async () => {
		const enumerate = async (title: ServiceRef): Promise<EnumeratedTitle> => {
			await Promise.resolve();
			if (title.serviceId === S2_REF.serviceId) {
				throw new NotEnumerableServiceError(title.service);
			}
			return enumerateFor(title);
		};
		const outcome = await discoverStructuralGroup({
			budget: 10,
			clients: totalDramaClients(enumerate),
			shared: SHARED,
		});
		expect(outcome).toStrictEqual({
			kind: "refused",
			reason: "unmappable-member",
		});
	});
});
