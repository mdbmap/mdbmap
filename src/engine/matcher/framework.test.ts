import type { InstalmentLocator } from "@/db/schema";
import { describe, expect, it } from "vitest";

import { alignStreams } from "./framework.ts";
import { mainSequence } from "./instalment.ts";
import type { Instalment, InstalmentStream, StreamBoundary } from "./instalment.ts";
import type { CandidatePairing, NonEmptyArray } from "./monotonic.ts";

const locator = (raw: string): InstalmentLocator => raw;

const locators = (
	raws: NonEmptyArray<string>,
): NonEmptyArray<InstalmentLocator> => {
	const [head, ...tail] = raws;
	return [locator(head), ...tail.map((raw) => locator(raw))];
};

const regular = (raw: string): Instalment => ({
	kind: "regular",
	locator: locator(raw),
});

const special = (raw: string): Instalment => ({
	kind: "special",
	locator: locator(raw),
});

const streamOf = (
	instalments: readonly Instalment[],
	boundary: StreamBoundary = "complete",
): InstalmentStream => ({ boundary, instalments });

const pair = (
	left: NonEmptyArray<string>,
	right: NonEmptyArray<string>,
): CandidatePairing => ({
	left: locators(left),
	right: locators(right),
});

describe("mainSequence", () => {
	it("excludes specials from cumulative offsets", () => {
		const stream = streamOf([
			regular("a#1"),
			regular("a#2"),
			special("a#sp"),
			regular("a#3"),
		]);
		expect(mainSequence(stream)).toStrictEqual([
			{ locator: locator("a#1"), offset: 1 },
			{ locator: locator("a#2"), offset: 2 },
			{ locator: locator("a#3"), offset: 3 },
		]);
	});
});

describe("alignStreams", () => {
	it("rejects a crossing pairing as non-monotonic", () => {
		const left = streamOf([regular("l#1"), regular("l#2")]);
		const right = streamOf([regular("r#1"), regular("r#2")]);
		const outcome = alignStreams(left, right, [
			pair(["l#1"], ["r#2"]),
			pair(["l#2"], ["r#1"]),
		]);
		expect(outcome.status).toBe("conflict");
		if (outcome.status === "conflict") {
			expect(outcome.crossings.length).toBeGreaterThan(0);
			expect(outcome.crossings.some((cross) => cross.side === "right")).toBe(
				true,
			);
		}
	});

	it("accepts a gapped and split alignment", () => {
		const left = streamOf([regular("l#1"), regular("l#2"), regular("l#3")]);
		const right = streamOf([
			regular("r#1"),
			regular("r#2a"),
			regular("r#2b"),
		]);
		// l#2 is unmapped (a gap); l#3 splits into two right instalments.
		const outcome = alignStreams(left, right, [
			pair(["l#1"], ["r#1"]),
			pair(["l#3"], ["r#2a", "r#2b"]),
		]);
		expect(outcome.status).toBe("published");
		if (outcome.status === "published") {
			expect(outcome.alignment.pairs).toHaveLength(2);
			expect(outcome.alignment.left.noCounterpart).toStrictEqual([
				locator("l#2"),
			]);
			expect(outcome.alignment.right.noCounterpart).toStrictEqual([]);
		}
	});

	it("keeps specials out of the crossing check", () => {
		const left = streamOf([regular("l#1"), regular("l#2"), special("l#sp")]);
		const right = streamOf([regular("r#1"), regular("r#2"), special("r#sp")]);
		// The specials pairing points "backwards" but must not conflict, since a
		// special carries no main-sequence position.
		const outcome = alignStreams(left, right, [
			pair(["l#1"], ["r#1"]),
			pair(["l#2"], ["r#2"]),
			pair(["l#sp"], ["r#sp"]),
		]);
		expect(outcome.status).toBe("published");
		if (outcome.status === "published") {
			expect(outcome.alignment.pairs).toHaveLength(3);
			expect(outcome.alignment.left.noCounterpart).toStrictEqual([]);
		}
	});

	it("publishes an airing prefix and leaves later positions pending", () => {
		const left = streamOf(
			[regular("l#1"), regular("l#2"), regular("l#3")],
			"airing",
		);
		const right = streamOf([regular("r#1"), regular("r#2")]);
		const outcome = alignStreams(left, right, [
			pair(["l#1"], ["r#1"]),
			pair(["l#2"], ["r#2"]),
		]);
		expect(outcome.status).toBe("published");
		if (outcome.status === "published") {
			expect(outcome.alignment.left.pending).toStrictEqual([locator("l#3")]);
			expect(outcome.alignment.left.noCounterpart).toStrictEqual([]);
		}
	});

	it("refuses to publish a truncated fetch", () => {
		const left = streamOf([regular("l#1")], "truncated");
		const right = streamOf([regular("r#1")]);
		const outcome = alignStreams(left, right, [pair(["l#1"], ["r#1"])]);
		expect(outcome).toStrictEqual({
			reason: "truncated-fetch",
			status: "unpublishable",
		});
	});
});
