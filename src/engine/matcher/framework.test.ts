import { describe, expect, it } from "vitest";

import { alignStreams } from "./framework.ts";
import { mainSequence } from "./instalment.ts";
import { locator, pair, regular, special, streamOf } from "./test-fixtures.ts";

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

	it("classifies a gapped released instalment of an airing stream as no-counterpart", () => {
		const left = streamOf(
			[regular("l#1"), regular("l#2"), regular("l#3"), regular("l#4")],
			"airing",
		);
		const right = streamOf([regular("r#1"), regular("r#3")]);
		// l#2 sits between paired l#1 and l#3 — released and unlinked, not future.
		// l#4 is beyond the settled prefix and remains pending.
		const outcome = alignStreams(left, right, [
			pair(["l#1"], ["r#1"]),
			pair(["l#3"], ["r#3"]),
		]);
		expect(outcome.status).toBe("published");
		if (outcome.status === "published") {
			expect(outcome.alignment.left.noCounterpart).toStrictEqual([
				locator("l#2"),
			]);
			expect(outcome.alignment.left.pending).toStrictEqual([locator("l#4")]);
		}
	});

	it("publishes an order-preserving alignment whose mixed pairing lands a special", () => {
		const left = streamOf([regular("l#1"), regular("l#2"), regular("l#3")]);
		const right = streamOf([special("r#sp"), regular("r#1"), regular("r#2")]);
		// l#3 pairs with the special stored at right index 0. The pairing's right
		// span must ignore that off-ordinal index — measured over its regulars
		// (none here) it imposes no right constraint, so the order-preserving set
		// publishes instead of false-conflicting on the special's storage slot.
		const outcome = alignStreams(left, right, [
			pair(["l#1"], ["r#1"]),
			pair(["l#2"], ["r#2"]),
			pair(["l#3"], ["r#sp"]),
		]);
		expect(outcome.status).toBe("published");
		if (outcome.status === "published") {
			expect(outcome.alignment.pairs).toHaveLength(3);
		}
	});

	it("rejects a regular reused across a mixed and a pure pairing", () => {
		const left = streamOf([regular("l#1"), regular("l#2")]);
		const right = streamOf([regular("r#1"), special("r#sp")]);
		// l#1 maps to a special on one pairing and a regular on another. Multi-
		// coverage lives within one pairing, so claiming l#1 twice is rejected.
		const outcome = alignStreams(left, right, [
			pair(["l#1"], ["r#sp"]),
			pair(["l#1"], ["r#1"]),
		]);
		expect(outcome.status).toBe("invalid");
		if (outcome.status === "invalid") {
			expect(outcome.reused).toStrictEqual([
				{ locator: locator("l#1"), side: "left" },
			]);
		}
	});

	it("rejects a special claimed by two pairings on the right", () => {
		const left = streamOf([regular("l#1"), regular("l#2")]);
		const right = streamOf([regular("r#1"), special("r#sp")]);
		// Both pairings' right side is the same special, so neither imposes a span.
		// Without the up-front check r#sp would publish in two pairs at once.
		const outcome = alignStreams(left, right, [
			pair(["l#1"], ["r#sp"]),
			pair(["l#2"], ["r#sp"]),
		]);
		expect(outcome.status).toBe("invalid");
		if (outcome.status === "invalid") {
			expect(outcome.reused).toStrictEqual([
				{ locator: locator("r#sp"), side: "right" },
			]);
		}
	});

	it("rejects a special claimed by two pairings on the left", () => {
		const left = streamOf([special("l#sp"), regular("l#1")]);
		const right = streamOf([regular("r#1"), regular("r#2")]);
		// Both left spans are undefined (all-special), the ranking path that would
		// otherwise compute Infinity - Infinity = NaN. The reuse is caught first.
		const outcome = alignStreams(left, right, [
			pair(["l#sp"], ["r#1"]),
			pair(["l#sp"], ["r#2"]),
		]);
		expect(outcome.status).toBe("invalid");
		if (outcome.status === "invalid") {
			expect(outcome.reused).toStrictEqual([
				{ locator: locator("l#sp"), side: "left" },
			]);
		}
	});

	it("detects a genuine crossing of distinct left locators", () => {
		const left = streamOf([regular("l#1"), regular("l#2"), regular("l#3")]);
		const right = streamOf([regular("r#1"), regular("r#2")]);
		// A merge over l#1 and l#3 overlaps the l#2 pairing on the left: distinct
		// locators, no reuse, but their left spans cross.
		const outcome = alignStreams(left, right, [
			pair(["l#1", "l#3"], ["r#1"]),
			pair(["l#2"], ["r#2"]),
		]);
		expect(outcome.status).toBe("conflict");
		if (outcome.status === "conflict") {
			expect(outcome.crossings.some((cross) => cross.side === "left")).toBe(
				true,
			);
		}
	});

	it("publishes multi-coverage expressed within a single pairing", () => {
		const left = streamOf([regular("l#1"), regular("l#2"), regular("l#3")]);
		const right = streamOf([
			regular("r#1"),
			regular("r#2a"),
			regular("r#2b"),
		]);
		// A merge (l#1 + l#2 into r#1) and a split (l#3 into r#2a + r#2b), each
		// contained in one pairing, share no locator and publish.
		const outcome = alignStreams(left, right, [
			pair(["l#1", "l#2"], ["r#1"]),
			pair(["l#3"], ["r#2a", "r#2b"]),
		]);
		expect(outcome.status).toBe("published");
		if (outcome.status === "published") {
			expect(outcome.alignment.pairs).toHaveLength(2);
			expect(outcome.alignment.left.noCounterpart).toStrictEqual([]);
			expect(outcome.alignment.right.noCounterpart).toStrictEqual([]);
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

	it("rejects a pairing whose right locator is absent from its stream", () => {
		const left = streamOf([regular("l#1"), regular("l#2")]);
		const right = streamOf([regular("r#1")]);
		const outcome = alignStreams(left, right, [
			pair(["l#1"], ["r#1"]),
			pair(["l#2"], ["phantom"]),
		]);
		expect(outcome.status).toBe("invalid");
		if (outcome.status === "invalid") {
			expect(outcome.strays).toStrictEqual([
				{ locator: locator("phantom"), side: "right" },
			]);
		}
	});

	it("rejects a pairing whose left locator is absent from its stream", () => {
		const left = streamOf([regular("l#1")]);
		const right = streamOf([regular("r#1"), regular("r#2")]);
		const outcome = alignStreams(left, right, [
			pair(["l#1"], ["r#1"]),
			pair(["phantom"], ["r#2"]),
		]);
		expect(outcome.status).toBe("invalid");
		if (outcome.status === "invalid") {
			expect(outcome.strays).toStrictEqual([
				{ locator: locator("phantom"), side: "left" },
			]);
		}
	});

	it("publishes a pairing touching a special when its locators are all present", () => {
		const left = streamOf([regular("l#1"), special("l#sp")]);
		const right = streamOf([regular("r#1"), special("r#sp")]);
		const outcome = alignStreams(left, right, [
			pair(["l#1"], ["r#1"]),
			pair(["l#sp"], ["r#sp"]),
		]);
		expect(outcome.status).toBe("published");
		if (outcome.status === "published") {
			expect(outcome.alignment.pairs).toHaveLength(2);
			expect(outcome.alignment.left.noCounterpart).toStrictEqual([]);
			expect(outcome.alignment.right.noCounterpart).toStrictEqual([]);
		}
	});
});
