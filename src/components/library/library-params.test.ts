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
		expect(parseLibrarySearch({ status: "plan_to_watch" })).toEqual({
			status: "plan_to_watch",
		});
	});

	it("keeps title and rating sorts", () => {
		expect(parseLibrarySearch({ sort: "title" })).toEqual({ sort: "title" });
		expect(parseLibrarySearch({ sort: "rating", status: "completed" })).toEqual(
			{ sort: "rating", status: "completed" },
		);
	});

	it("keeps a title query and media kind", () => {
		expect(parseLibrarySearch({ kind: "anime", q: "spy" })).toEqual({
			kind: "anime",
			q: "spy",
		});
		expect(
			parseLibrarySearch({
				kind: "tv",
				q: "  abyss  ",
				sort: "title",
				status: "watching",
			}),
		).toEqual({
			kind: "tv",
			q: "  abyss  ",
			sort: "title",
			status: "watching",
		});
	});

	it("omits empty query and unknown kind", () => {
		expect(parseLibrarySearch({ kind: "book", q: "   " })).toEqual({});
		expect(parseLibrarySearch({ kind: 1, q: true })).toEqual({});
	});

	it("roundtrips a parsed search object", () => {
		const parsed = parseLibrarySearch({
			kind: "film",
			q: "Matrix",
			sort: "rating",
			status: "completed",
		});
		expect(parseLibrarySearch(parsed)).toEqual(parsed);
	});
});

describe("parseLibrarySearch title query", () => {
	it("round-trips a multi-word query including interior spaces", () => {
		expect(parseLibrarySearch({ q: "made in abyss" })).toEqual({
			q: "made in abyss",
		});
		expect(parseLibrarySearch({ q: "made in abyss " })).toEqual({
			q: "made in abyss ",
		});
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

	it("does not send title or kind filters to library.list", () => {
		expect(
			libraryListInput({
				kind: "anime",
				q: "spy",
				status: "watching",
			}),
		).toEqual({ status: "watching" });
	});
});
