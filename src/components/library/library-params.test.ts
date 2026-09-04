import { describe, expect, it } from "vitest";

import { libraryListInput, parseLibrarySearch } from "./library-params";

describe("parseLibrarySearch", () => {
	it("returns an empty object for missing or junk values", () => {
		expect(parseLibrarySearch({})).toEqual({});
		expect(parseLibrarySearch({ sort: "nope", status: "binging" })).toEqual({});
		expect(parseLibrarySearch({ sort: 1, status: true })).toEqual({});
	});

	it("keeps a known status and omits the default activity sort", () => {
		expect(
			parseLibrarySearch({ sort: "activity", status: "watching" }),
		).toEqual({ status: "watching" });
	});

	it("keeps title and rating sorts", () => {
		expect(parseLibrarySearch({ sort: "title" })).toEqual({ sort: "title" });
		expect(parseLibrarySearch({ sort: "rating", status: "completed" })).toEqual(
			{ sort: "rating", status: "completed" },
		);
	});
});

describe("libraryListInput", () => {
	it("omits undefined keys so the query key stays sparse", () => {
		expect(libraryListInput({})).toEqual({});
		expect(libraryListInput({ sort: "title", status: "on_hold" })).toEqual({
			sort: "title",
			status: "on_hold",
		});
	});
});
