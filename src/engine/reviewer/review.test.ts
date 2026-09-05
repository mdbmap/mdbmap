import { describe, expect, it } from "vitest";

import { reviewProposal } from "./review.ts";
import type { ReviewJudge } from "./review.ts";
import type { ReviewProposal } from "./types.ts";

const proposal: ReviewProposal = {
	assertionId: 1,
	claim: "tmdb:1396 and tvdb:81189 are the same title",
	evidence: [
		{
			kind: "api",
			operator: "tvdb",
			summary: "TVDB record confirms the same run",
			url: "https://api.thetvdb.com/series/81189",
		},
	],
	kind: "title",
};

const staticJudge =
	(raw: unknown): ReviewJudge =>
	() =>
		raw;

describe("reviewProposal", () => {
	it("promotes on a supporting verdict", async () => {
		const outcome = await reviewProposal(
			proposal,
			staticJudge({ rationale: "both sides agree", verdict: "supporting" }),
		);
		expect(outcome).toEqual({
			kind: "promoted",
			rationale: "both sides agree",
		});
	});

	it("escalates on a disputing verdict", async () => {
		const outcome = await reviewProposal(
			proposal,
			staticJudge({ rationale: "counts disagree", verdict: "disputing" }),
		);
		expect(outcome).toEqual({
			kind: "escalated",
			rationale: "counts disagree",
			reason: "disputing",
		});
	});

	it("escalates on an unable-to-tell verdict", async () => {
		const outcome = await reviewProposal(
			proposal,
			staticJudge({
				rationale: "not enough evidence",
				verdict: "unable-to-tell",
			}),
		);
		expect(outcome).toEqual({
			kind: "escalated",
			rationale: "not enough evidence",
			reason: "unable-to-tell",
		});
	});

	it("escalates instead of promoting on a well-formed but unrecognised verdict", async () => {
		const outcome = await reviewProposal(
			proposal,
			staticJudge({ rationale: "sounds right", verdict: "confirmed" }),
		);
		expect(outcome).toEqual({
			kind: "escalated",
			rationale: undefined,
			reason: "malformed-output",
		});
	});

	it("escalates instead of promoting when the model omits the rationale", async () => {
		const outcome = await reviewProposal(
			proposal,
			staticJudge({ verdict: "supporting" }),
		);
		expect(outcome).toEqual({
			kind: "escalated",
			rationale: undefined,
			reason: "malformed-output",
		});
	});

	it("escalates instead of promoting on a non-object answer", async () => {
		const outcome = await reviewProposal(proposal, staticJudge("supporting"));
		expect(outcome).toEqual({
			kind: "escalated",
			rationale: undefined,
			reason: "malformed-output",
		});
	});

	it("passes the proposal through to the judge untouched", async () => {
		let seen: ReviewProposal | undefined;
		await reviewProposal(proposal, (received) => {
			seen = received;
			return { rationale: "ok", verdict: "supporting" };
		});
		expect(seen).toBe(proposal);
	});
});
