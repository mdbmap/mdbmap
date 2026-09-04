import { describe, expect, it } from "vitest";

import { watchSpan } from "./watch-span.ts";

const at = (iso: string): Date => new Date(`${iso}T12:00:00.000Z`);
const april = at("2026-04-09");
const midApril = at("2026-04-16");
const june = at("2026-06-25");
const emptyWatched = new Map<string, Date>();
const strayWatched = new Map([["ep:1", april]]);
const partialWatched = new Map([
	["ep:2", midApril],
	["ep:1", april],
]);
const completeWatched = new Map([
	["ep:1", april],
	["ep:2", june],
]);
const noDates = {
	finishedAt: undefined,
	startedAt: undefined,
};

describe("watchSpan", () => {
	it("returns no dates when nothing is watched", () => {
		expect(watchSpan(["ep:1", "ep:2"], emptyWatched)).toEqual(noDates);
		expect(watchSpan([], strayWatched)).toEqual(noDates);
	});

	it("uses the earliest watched day as startedAt", () => {
		expect(watchSpan(["ep:1", "ep:2", "ep:3"], partialWatched)).toEqual({
			finishedAt: undefined,
			startedAt: "2026-04-09",
		});
	});

	it("sets finishedAt only when every locator is watched", () => {
		expect(watchSpan(["ep:1", "ep:2"], completeWatched)).toEqual({
			finishedAt: "2026-06-25",
			startedAt: "2026-04-09",
		});
	});
});
