import { describe, expect, it } from "vitest";

import { parseHomeSearch } from "./home-search";

describe("parseHomeSearch", () => {
	it("reads signin=1 as a request to open the auth dialog", () => {
		expect(parseHomeSearch({ signin: "1" })).toStrictEqual({ signin: true });
	});

	it("drops anything else", () => {
		expect(parseHomeSearch({ signin: "yes" })).toStrictEqual({});
		expect(parseHomeSearch({ signin: "0" })).toStrictEqual({});
		expect(parseHomeSearch({})).toStrictEqual({});
	});
});
