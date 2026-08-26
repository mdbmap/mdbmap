import type { Promisable } from "type-fest";

import type { Db } from "@/db";

import { promoteAssertion } from "./promote.ts";
import { reviewProposal } from "./review.ts";
import type {
	EscalatedReview,
	EscalationReason,
	ReviewJudge,
} from "./review.ts";
import type { ReviewProposal } from "./types.ts";

// The reviewer's task shape (ADR-0004, issue #61): one proposal in, one model
// call, one write out. Fired event-driven per proposal — never batched, never
// routed through the heavyweight overflow Workflow (#45).
interface ReviewTaskDeps {
	readonly db: Db;
	// Records a human-review escalation; its destination is the caller's concern.
	readonly escalate: (
		proposal: ReviewProposal,
		reason: EscalationReason,
		rationale: string | undefined,
	) => Promisable<void>;
	readonly judge: ReviewJudge;
}

type ReviewTaskResult =
	| EscalatedReview
	| { readonly kind: "promoted" }
	// The assertion no longer carried `llm-research` by the time the verdict
	// landed (already promoted, or reassigned by another writer entirely).
	| { readonly kind: "stale" };

const reviewResearchProposal = async (
	proposal: ReviewProposal,
	deps: ReviewTaskDeps,
): Promise<ReviewTaskResult> => {
	const outcome = await reviewProposal(proposal, deps.judge);
	if (outcome.kind === "escalated") {
		await deps.escalate(proposal, outcome.reason, outcome.rationale);
		return outcome;
	}
	const promoted = await promoteAssertion(
		deps.db,
		proposal.kind,
		proposal.assertionId,
	);
	if (promoted === "missing") {
		const result: EscalatedReview = {
			kind: "escalated",
			rationale: outcome.rationale,
			reason: "missing-assertion",
		};
		await deps.escalate(proposal, result.reason, result.rationale);
		return result;
	}
	return promoted === "promoted" ? { kind: "promoted" } : { kind: "stale" };
};

export { reviewResearchProposal };
export type { ReviewTaskDeps, ReviewTaskResult };
