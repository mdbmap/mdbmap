import { describe, expect, it } from "vitest";

import type { Identity, ParseErrorReason, Profile } from "./identity.ts";
import { FormatError, formatId, parseId } from "./identity.ts";

// Each canonical case must both parse to its identity and format back to the
// exact string it came from.
const roundTrips: readonly {
	readonly identity: Identity;
	readonly profile: Profile;
	readonly raw: string;
}[] = [
	{
		identity: { kind: "title", title: { id: "603", namespace: "movie", service: "tmdb" } },
		profile: "movie",
		raw: "tmdb:603",
	},
	{
		identity: { kind: "title", title: { id: "tt0133093", service: "imdb" } },
		profile: "movie",
		raw: "tt0133093",
	},
	{
		identity: { kind: "title", title: { id: "1399", namespace: "tv", service: "tmdb" } },
		profile: "series",
		raw: "tmdb:1399",
	},
	{
		identity: {
			kind: "instalment",
			locator: { episode: 5, season: 2 },
			title: { id: "1399", namespace: "tv", service: "tmdb" },
		},
		profile: "series",
		raw: "tmdb:1399:2:5",
	},
	{
		identity: {
			kind: "instalment",
			locator: { episode: 2, season: 1 },
			title: { id: "tt0944947", service: "imdb" },
		},
		profile: "series",
		raw: "tt0944947:1:2",
	},
	{
		identity: { kind: "title", title: { id: "44081", service: "kitsu" } },
		profile: "anime",
		raw: "kitsu:44081",
	},
	{
		identity: {
			kind: "instalment",
			locator: { episode: 5, season: 1 },
			title: { id: "44081", service: "kitsu" },
		},
		profile: "anime",
		raw: "kitsu:44081:5",
	},
	{
		identity: {
			kind: "instalment",
			locator: { episode: 3, season: 1 },
			title: { id: "50265", service: "mal" },
		},
		profile: "anime",
		raw: "mal:50265:3",
	},
	{
		identity: {
			kind: "instalment",
			locator: { episode: 7, season: 1 },
			title: { id: "140960", service: "anilist" },
		},
		profile: "anime",
		raw: "anilist:140960:7",
	},
	{
		identity: {
			kind: "instalment",
			locator: { episode: 5, season: 2 },
			title: { id: "81797", service: "tvdb" },
		},
		profile: "anime",
		raw: "tvdb:81797:2:5",
	},
];

const rejections: readonly {
	readonly profile: Profile;
	readonly raw: string;
	readonly reason: ParseErrorReason;
}[] = [
	{ profile: "anime", raw: "tmdb:603", reason: "tmdb-not-in-anime" },
	{ profile: "anime", raw: "tmdb:1399:2:5", reason: "tmdb-not-in-anime" },
	{ profile: "anime", raw: "kitsu:44081:2:5", reason: "season-not-one" },
	{ profile: "anime", raw: "kitsu:44081:x:5", reason: "malformed-locator" },
	{ profile: "anime", raw: "kitsu:44081:1:2:5", reason: "extra-qualifier-segment" },
	{ profile: "series", raw: "tmdb:1399:2:5:7", reason: "extra-qualifier-segment" },
	{ profile: "series", raw: "tmdb:1399:2", reason: "malformed-locator" },
	{ profile: "series", raw: "tmdb:", reason: "malformed-native-id" },
	{ profile: "series", raw: "floop:1", reason: "unrecognised-service" },
	{ profile: "series", raw: "", reason: "unrecognised-service" },
	{ profile: "movie", raw: "tmdb:603:1:2", reason: "positional-not-allowed" },
	{ profile: "movie", raw: "kitsu:44081", reason: "service-not-in-profile" },
];

describe("parseId round-trips", () => {
	it.each(roundTrips)("parses $raw under /$profile", ({ identity, profile, raw }) => {
		expect(parseId(profile, raw)).toStrictEqual({ identity, ok: true });
	});

	it.each(roundTrips)("formats $raw back from its identity", ({ identity, raw }) => {
		expect(formatId(identity)).toBe(raw);
	});
});

describe("flat-or-season-one", () => {
	it("accepts the bare-episode form", () => {
		expect(parseId("anime", "kitsu:44081:5")).toStrictEqual({
			identity: {
				kind: "instalment",
				locator: { episode: 5, season: 1 },
				title: { id: "44081", service: "kitsu" },
			},
			ok: true,
		});
	});

	it("accepts the explicit season-1 form as the same request", () => {
		expect(parseId("anime", "kitsu:44081:1:5")).toStrictEqual(parseId("anime", "kitsu:44081:5"));
	});

	it("normalises the season-1 form back to the bare-episode canonical", () => {
		const result = parseId("anime", "kitsu:44081:1:5");
		if (!result.ok) {
			throw new Error("expected kitsu:44081:1:5 to parse");
		}
		expect(formatId(result.identity)).toBe("kitsu:44081:5");
	});

	it("applies to mal and anilist prefixes too", () => {
		expect(parseId("anime", "mal:50265:1:3")).toStrictEqual(parseId("anime", "mal:50265:3"));
		expect(parseId("anime", "anilist:140960:1:7")).toStrictEqual(
			parseId("anime", "anilist:140960:7"),
		);
	});
});

describe("formatId flat-mode season guard", () => {
	it("throws rather than dropping a non-1 season for a flat service", () => {
		const identity: Identity = {
			kind: "instalment",
			locator: { episode: 5, season: 2 },
			title: { id: "44081", service: "kitsu" },
		};
		expect(() => formatId(identity)).toThrow(FormatError);
	});

	it("still round-trips a valid flat-mode identity", () => {
		const identity: Identity = {
			kind: "instalment",
			locator: { episode: 5, season: 1 },
			title: { id: "44081", service: "kitsu" },
		};
		expect(formatId(identity)).toBe("kitsu:44081:5");
	});
});

describe("parseId rejections", () => {
	it.each(rejections)("rejects $raw under /$profile as $reason", ({ profile, raw, reason }) => {
		const result = parseId(profile, raw);
		if (result.ok) {
			throw new Error(`expected ${raw} to be rejected`);
		}
		expect(result.error.reason).toBe(reason);
		expect(result.error.expected.length).toBeGreaterThan(0);
	});
});
