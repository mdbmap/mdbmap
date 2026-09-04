import { describe, expect, it } from "vitest";

import type { MemberTitles, Segment } from "@/engine";

import { catalogueLinks } from "./catalogue-links.ts";

const episodic = (members: MemberTitles): Segment => ({
	instalments: [],
	kind: "episodic",
	members,
});

const atomic = (members: MemberTitles): Segment => ({
	instalments: [],
	kind: "atomic",
	members,
});

const spyXFamily = [
	episodic({
		anidb: "16947",
		anilist: "140960",
		mal: "50265",
		tmdb: "120089",
	}),
	episodic({
		anidb: "17061",
		anilist: "142838",
		mal: "50602",
		tmdb: "120089",
	}),
	episodic({
		anidb: "17784",
		anilist: "158927",
		mal: "53887",
		tmdb: "120089",
	}),
];

const idsOf = (service: string, links: ReturnType<typeof catalogueLinks>) =>
	links.filter((link) => link.service === service).map((link) => link.id);

const hrefOf = (service: string, links: ReturnType<typeof catalogueLinks>) =>
	links.find((link) => link.service === service)?.href;

describe("catalogueLinks spy x family members", () => {
	it("keeps unique multi-cour AniDB, MAL, and AniList ids in part order", () => {
		const links = catalogueLinks(spyXFamily);
		expect(idsOf("anidb", links)).toEqual(["16947", "17061", "17784"]);
		expect(idsOf("mal", links)).toEqual(["50265", "50602", "53887"]);
		expect(idsOf("anilist", links)).toEqual(["140960", "142838", "158927"]);
		expect(links.map((link) => link.service)).toEqual([
			"anidb",
			"anidb",
			"anidb",
			"mal",
			"mal",
			"mal",
			"anilist",
			"anilist",
			"anilist",
			"tmdb",
		]);
	});

	it("emits one TMDB tv URL when the same episodic id spans cours", () => {
		const links = catalogueLinks(spyXFamily);
		expect(idsOf("tmdb", links)).toEqual(["120089"]);
		expect(hrefOf("tmdb", links)).toBe("https://www.themoviedb.org/tv/120089");
		expect(links.find((link) => link.service === "tmdb")?.label).toBe("TMDB");
	});
});

describe("catalogueLinks labels", () => {
	it("qualifies labels with metadata part names when a service has several ids", () => {
		const links = catalogueLinks(spyXFamily, ["Cour 1", "Cour 2", "Cour 3"]);
		expect(
			links
				.filter((link) => link.service === "anidb")
				.map((link) => link.label),
		).toEqual(["AniDB · Cour 1", "AniDB · Cour 2", "AniDB · Cour 3"]);
		expect(links.find((link) => link.id === "50265")?.label).toBe(
			"MAL · Cour 1",
		);
		expect(links.find((link) => link.id === "140960")?.label).toBe(
			"AniList · Cour 1",
		);
	});

	it("falls back to Part n when a multi-id service has no metadata label", () => {
		const links = catalogueLinks(spyXFamily);
		expect(links.find((link) => link.id === "17061")?.label).toBe(
			"AniDB · Part 2",
		);
		expect(links.find((link) => link.id === "16947")?.href).toBe(
			"https://anidb.net/anime/16947",
		);
		expect(links.find((link) => link.id === "50265")?.href).toBe(
			"https://myanimelist.net/anime/50265",
		);
		expect(links.find((link) => link.id === "140960")?.href).toBe(
			"https://anilist.co/anime/140960",
		);
	});
});

describe("catalogueLinks hrefs", () => {
	it("uses a TMDB movie URL for an atomic segment", () => {
		const links = catalogueLinks([atomic({ tmdb: "603" })]);
		expect(links).toEqual([
			{
				href: "https://www.themoviedb.org/movie/603",
				id: "603",
				label: "TMDB",
				service: "tmdb",
			},
		]);
	});

	it("builds an IMDb title URL and hides services with no members", () => {
		const links = catalogueLinks([atomic({ imdb: "tt0133093", tmdb: "603" })]);
		expect(hrefOf("imdb", links)).toBe("https://www.imdb.com/title/tt0133093/");
		expect(links.map((link) => link.service)).toEqual(["tmdb", "imdb"]);
		expect(catalogueLinks([])).toEqual([]);
	});
});
