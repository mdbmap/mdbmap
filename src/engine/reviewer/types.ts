// Shared shapes for the structured-verdict reviewer (ADR-0004, issue #61). The
// reviewer is deliberately decoupled from the research pass and corroboration
// gate (#59, #60): it judges a rendered claim plus the evidence already
// captured for it, never the graph itself, so it stays cheap and tool-free.

const reviewVerdicts = ["supporting", "disputing", "unable-to-tell"] as const;
type ReviewVerdict = (typeof reviewVerdicts)[number];

const proposalKinds = ["instalment", "relation", "title"] as const;
type ProposalKind = (typeof proposalKinds)[number];

const evidenceKinds = ["api", "scrape"] as const;
type EvidenceKind = (typeof evidenceKinds)[number];

// One leg of evidence the research pass already fetched — never a live tool
// the reviewer could call itself.
interface CapturedEvidence {
	readonly kind: EvidenceKind;
	readonly operator: string;
	readonly summary: string;
	readonly url: string;
}

// An `llm-research` assertion awaiting review. `assertionId` names the row in
// whichever table `kind` selects; `claim` is the orchestrator's rendered
// description of what that row asserts, so the reviewer never needs graph
// access to judge it.
interface ReviewProposal {
	readonly assertionId: number;
	readonly claim: string;
	readonly evidence: readonly CapturedEvidence[];
	readonly kind: ProposalKind;
}

export { evidenceKinds, proposalKinds, reviewVerdicts };
export type {
	CapturedEvidence,
	EvidenceKind,
	ProposalKind,
	ReviewProposal,
	ReviewVerdict,
};
