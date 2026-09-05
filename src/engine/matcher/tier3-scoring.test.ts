import { describe, expect, it } from "vitest";

import {
	dayDistance,
	editDistance,
	normaliseTitle,
	titleSimilarity,
	tokenOverlap,
} from "./tier3-scoring.ts";

describe("normaliseTitle", () => {
	it("lowercases and strips punctuation to a single-spaced form", () => {
		expect(normaliseTitle("Pups Save the Bay!")).toBe("pups save the bay");
		expect(normaliseTitle("  Kitty-tastrophe  ")).toBe("kitty tastrophe");
	});
});

describe("editDistance", () => {
	it("is zero for equal strings and symmetric otherwise", () => {
		expect(editDistance("attack", "attack")).toBe(0);
		expect(editDistance("kitten", "sitting")).toBe(3);
		expect(editDistance("sitting", "kitten")).toBe(3);
	});

	it("degrades to length against an empty string", () => {
		expect(editDistance("", "titan")).toBe(5);
		expect(editDistance("titan", "")).toBe(5);
	});
});

describe("tokenOverlap", () => {
	it("is the Jaccard ratio of the two token sets", () => {
		expect(tokenOverlap(["pups", "save"], ["pups", "save"])).toBe(1);
		expect(
			tokenOverlap(["beach", "episode"], ["beach", "day", "episode"]),
		).toBeCloseTo(2 / 3);
		expect(tokenOverlap(["recap"], ["finale"])).toBe(0);
	});
});

describe("titleSimilarity", () => {
	it("scores identical titles at one and unrelated titles near zero", () => {
		expect(titleSimilarity("Attack on Titan", "attack on titan")).toBe(1);
		expect(titleSimilarity("Recap", "Finale")).toBeLessThan(0.2);
	});

	it("ranks a near title above an unrelated one", () => {
		const near = titleSimilarity("Beach Episode", "Beach Day Episode");
		const far = titleSimilarity("Beach Episode", "Mountain Trek");
		expect(near).toBeGreaterThan(far);
	});
});

describe("dayDistance", () => {
	it("counts whole days apart and undefined for an unparseable date", () => {
		expect(dayDistance("2013-08-12", "2013-08-12")).toBe(0);
		expect(dayDistance("2013-08-12", "2013-08-13")).toBe(1);
		expect(dayDistance("2013-08-12", "2013-08-20")).toBe(8);
		expect(dayDistance("not-a-date", "2013-08-12")).toBeUndefined();
	});
});
