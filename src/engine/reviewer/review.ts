import type { Promisable } from "type-fest";

import type { ReviewProposal, ReviewVerdict } from "./types.ts";
import { parseVerdict } from "./verdict-schema.ts";
import type { RawVerdict } from "./verdict-schema.ts";

// One tool-free call to a configured model (ADR-0004): the reviewer sees only
// the proposal and its captured evidence, never live tools. Tests mock this
// directly; the provider store (#57/#58) supplies the real model call.
type ReviewJudge = (proposal: ReviewProposal) => Promisable<unknown>;

type EscalationReason =
	| Exclude<ReviewVerdict, "supporting">
	| "malformed-output"
	| "missing-assertion";

interface EscalatedReview {
	readonly kind: "escalated";
	readonly rationale: string | undefined;
	readonly reason: EscalationReason;
}

type ReviewOutcome =
	| EscalatedReview
	| { readonly kind: "promoted"; readonly rationale: string };

const outcomeFor = (verdict: RawVerdict): ReviewOutcome =>
	verdict.verdict === "supporting"
		? { kind: "promoted", rationale: verdict.rationale }
		: {
				kind: "escalated",
				rationale: verdict.rationale,
				reason: verdict.verdict,
			};

// Judges one proposal with a single tool-free model call and turns its raw
// answer into a promote/escalate outcome. A malformed answer escalates just
// like a disputing verdict — hallucinated structure never promotes.
const reviewProposal = async (
	proposal: ReviewProposal,
	judge: ReviewJudge,
): Promise<ReviewOutcome> => {
	const raw = await judge(proposal);
	const parsed = parseVerdict(raw);
	return parsed.kind === "malformed"
		? {
				kind: "escalated",
				rationale: undefined,
				reason: "malformed-output",
			}
		: outcomeFor(parsed.verdict);
};

export { reviewProposal };
export type { EscalatedReview, EscalationReason, ReviewJudge, ReviewOutcome };
