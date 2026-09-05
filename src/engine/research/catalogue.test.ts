import { describe, expect, it } from "vitest";

import { parseResearchCatalogue, toCatalogueTitle } from "./catalogue.ts";

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

	it("carries locatorKind through the catalogue schema", () => {
		const record = parseResearchCatalogue({
			instalments: [
				{ locator: "ep-1", locatorKind: "service-id" },
				{ locator: "1:2" },
			],
			title: "Show",
		});
		expect(record.instalments).toEqual([
			{ kind: "regular", locator: "ep-1", locatorKind: "service-id" },
			{ kind: "regular", locator: "1:2", locatorKind: "position" },
		]);
	});
});
