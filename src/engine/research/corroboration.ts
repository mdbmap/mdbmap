// Research corroboration gate (ADR-0004, #60).

type EvidenceVerdict = "corroborates" | "contradicts";

interface ApiEvidence {
	readonly kind: "api";
	readonly official: boolean;
	readonly operator: string;
	readonly validated: boolean;
	readonly verdict: EvidenceVerdict;
}

interface ScrapeEvidence {
	readonly kind: "scrape";
	readonly official: boolean;
	readonly operator: string;
	readonly verdict: EvidenceVerdict;
}

interface CommunityWikiEvidence {
	readonly kind: "community-wiki";
	readonly official: boolean;
	readonly operator: string;
	readonly verdict: EvidenceVerdict;
}

type CorroborationEvidence =
	| ApiEvidence
	| CommunityWikiEvidence
	| ScrapeEvidence;

type CorroborationDecision =
	| {
			readonly confidence: "high";
			readonly reviewFlag: undefined;
	  }
	| {
			readonly confidence: "low";
			readonly reviewFlag: "low-confidence-flag";
	  };

const lowConfidenceDecision: CorroborationDecision = {
	confidence: "low",
	reviewFlag: "low-confidence-flag",
};

const highConfidenceDecision: CorroborationDecision = {
	confidence: "high",
	reviewFlag: undefined,
};

const eligibleEvidence = (
	evidence: readonly CorroborationEvidence[],
): readonly (ApiEvidence | ScrapeEvidence)[] =>
	evidence.filter(
		(item): item is ApiEvidence | ScrapeEvidence =>
			item.official && item.kind !== "community-wiki",
	);

const corroborate = (
	evidence: readonly CorroborationEvidence[],
): CorroborationDecision => {
	const eligible = eligibleEvidence(evidence);
	if (
		eligible.some(
			(item) => item.kind === "scrape" || item.verdict === "contradicts",
		)
	) {
		return lowConfidenceDecision;
	}

	const operators = new Set(
		eligible
			.filter((item) => item.verdict === "corroborates")
			.map((item) => item.operator),
	);
	const hasValidatedApi = eligible.some(
		(item) =>
			item.kind === "api" &&
			item.validated &&
			item.verdict === "corroborates",
	);

	return operators.size >= 2 && hasValidatedApi
		? highConfidenceDecision
		: lowConfidenceDecision;
};

export { corroborate };
export type {
	ApiEvidence,
	CommunityWikiEvidence,
	CorroborationDecision,
	CorroborationEvidence,
	EvidenceVerdict,
	ScrapeEvidence,
};
