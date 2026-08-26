import { describe, expect, it } from "vitest";

import {
	parseResearchCatalogue,
	toCatalogueTitle,
} from "./catalogue.ts";

describe("research catalogue validators", () => {
	it("parses the same title fields the discovery CatalogueClient exposes", () => {
		const record = parseResearchCatalogue({
			format: "TV",
			instalmentCount: 2,
			instalments: [{ locator: "1:1" }, { locator: "1:2" }],
			releaseDate: "2008-01-20",
			title: "Breaking Bad",
		});
		expect(toCatalogueTitle(record)).toEqual({
			format: "TV",
			instalmentCount: 2,
			releaseDate: "2008-01-20",
			title: "Breaking Bad",
		});
	});

	it("rejects an empty title the way a server client would", () => {
		expect(() => parseResearchCatalogue({ title: "" })).toThrow();
	});
});
