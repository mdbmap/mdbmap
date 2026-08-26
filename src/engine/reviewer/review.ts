import type { Promisable } from "type-fest";

import type { ReviewProposal } from "./types.ts";
import { parseVerdict } from "./verdict-schema.ts";
import type { RawVerdict } from "./verdict-schema.ts";

// One tool-free call to a configured model (ADR-0004): the reviewer sees only
// the proposal and its captured evidence, never live tools. Tests mock this
// directly; the provider store (#57/#58) supplies the real model call.
type ReviewJudge = (proposal: ReviewProposal) => Promisable<unknown>;

type EscalationReason =
	| "disputing"
	| "malformed-output"
	| "missing-assertion"
	| "unable-to-tell";

type ReviewOutcome =
	| { readonly kind: "escalated"; readonly reason: EscalationReason }
	| { readonly kind: "promoted" };

const outcomeFor = (verdict: RawVerdict["verdict"]): ReviewOutcome =>
	verdict === "supporting"
		? { kind: "promoted" }
		: { kind: "escalated", reason: verdict };

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
		? { kind: "escalated", reason: "malformed-output" }
		: outcomeFor(parsed.verdict.verdict);
};

export { reviewProposal };
export type { EscalationReason, ReviewJudge, ReviewOutcome };
