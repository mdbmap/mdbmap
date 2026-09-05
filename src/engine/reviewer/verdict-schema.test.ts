import { describe, expect, it } from "vitest";

import { parseVerdict } from "./verdict-schema.ts";

describe("parseVerdict", () => {
	it("parses each glossary verdict with a rationale", () => {
		for (const verdict of ["supporting", "disputing", "unable-to-tell"]) {
			const parsed = parseVerdict({ rationale: "because", verdict });
			expect(parsed).toEqual({
				kind: "parsed",
				verdict: { rationale: "because", verdict },
			});
		}
	});

	it("rejects an unrecognised verdict value", () => {
		expect(
			parseVerdict({ rationale: "because", verdict: "confirmed" }),
		).toEqual({
			kind: "malformed",
		});
	});

	it("rejects a missing rationale", () => {
		expect(parseVerdict({ verdict: "supporting" })).toEqual({
			kind: "malformed",
		});
	});

	it("rejects an empty rationale", () => {
		expect(parseVerdict({ rationale: "", verdict: "supporting" })).toEqual({
			kind: "malformed",
		});
	});

	it("rejects a bare string instead of an object", () => {
		expect(parseVerdict("supporting")).toEqual({ kind: "malformed" });
	});

	it("rejects null and undefined", () => {
		const nullValue: unknown = JSON.parse("null");
		expect(parseVerdict(nullValue)).toEqual({ kind: "malformed" });
		expect(parseVerdict(undefined)).toEqual({ kind: "malformed" });
	});

	it("rejects a verdict field that is the wrong type", () => {
		expect(
			parseVerdict({ rationale: "because", verdict: ["supporting"] }),
		).toEqual({ kind: "malformed" });
	});
});
