import { isNotFound } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";

import { parseWorkParams, stringifyWorkParams } from "./work-params";

describe("parseWorkParams", () => {
	it("parses a numeric work path", () => {
		expect(parseWorkParams({ continuityId: "12" })).toEqual({
			continuityId: 12,
		});
	});

	it("throws a TanStack not-found for a non-numeric path", () => {
		try {
			parseWorkParams({ continuityId: "spy" });
			throw new Error("expected notFound");
		} catch (error) {
			expect(isNotFound(error)).toBe(true);
		}
	});
});

describe("stringifyWorkParams", () => {
	it("writes the numeric id back to the path", () => {
		expect(stringifyWorkParams({ continuityId: 12 })).toEqual({
			continuityId: "12",
		});
	});
});
