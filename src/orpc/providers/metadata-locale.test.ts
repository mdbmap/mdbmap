import { describe, expect, it } from "vitest";

import { pickLocalized, pickTitle } from "./metadata-locale.ts";

describe("pickLocalized", () => {
	const rows = [
		{ locale: "en", synopsis: "English plot", title: "Spy x Family" },
		{ locale: "de", synopsis: "Deutsche Handlung", title: "Spy x Family" },
		{ locale: "ja", synopsis: "あらすじ", title: "SPY×FAMILY" },
	];

	it("prefers an exact locale then the language then English", () => {
		expect(pickLocalized(rows, "de")?.synopsis).toBe("Deutsche Handlung");
		expect(pickLocalized(rows, "de-DE")?.title).toBe("Spy x Family");
		expect(pickLocalized(rows, "fr")?.title).toBe("Spy x Family");
	});
});

describe("pickTitle", () => {
	const titles = [
		{ locale: "x-jat", text: "Spy x Family", type: "main" },
		{ locale: "ja", text: "SPY×FAMILY", type: "official" },
		{ locale: "en", text: "Spy x Family", type: "official" },
		{ locale: "de", text: "Spy x Family DE", type: "official" },
	];

	it("picks an official title in the requested locale", () => {
		expect(pickTitle(titles, "de", "fallback")).toBe("Spy x Family DE");
		expect(pickTitle(titles, "ja", "fallback")).toBe("SPY×FAMILY");
	});

	it("falls back to main then English", () => {
		expect(pickTitle(titles, "fr", "fallback")).toBe("Spy x Family");
	});
});
