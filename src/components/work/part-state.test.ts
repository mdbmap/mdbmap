import { describe, expect, it } from "vitest";

import { resolveSelectedIndex } from "./part-state";

describe("resolveSelectedIndex", () => {
	it("defaults an untouched selection to the last part", () => {
		expect(resolveSelectedIndex(undefined, 3)).toBe(2);
	});

	it("keeps an explicit in-range selection", () => {
		expect(resolveSelectedIndex(1, 3)).toBe(1);
	});

	it("clamps a selection carried over from a longer work", () => {
		expect(resolveSelectedIndex(4, 2)).toBe(1);
	});

	it("stays at zero when there are no parts", () => {
		expect(resolveSelectedIndex(undefined, 0)).toBe(0);
	});
});
