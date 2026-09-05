// Research corroboration gate (ADR-0004, #60).

import type { AssertionConfidence } from "@/db/columns.ts";

type SourceStance = "corroborates" | "contradicts";

interface ApiEvidence {
	readonly kind: "api";
	readonly official: true;
	readonly operator: string;
	readonly stance: SourceStance;
	readonly url: string;
	readonly validated: boolean;
}

interface ScrapeEvidence {
	readonly kind: "scrape";
	readonly official: true;
	readonly operator: string;
	readonly stance: SourceStance;
	readonly url: string;
}

interface CommunityWikiEvidence {
	readonly kind: "community-wiki";
	readonly official: false;
	readonly operator: string;
	readonly stance: SourceStance;
}

type CorroborationEvidence =
	| ApiEvidence
	| CommunityWikiEvidence
	| ScrapeEvidence;

type CorroborationDecision =
	| {
			readonly confidence: Extract<AssertionConfidence, "high">;
			readonly reviewFlag: undefined;
	  }
	| {
			readonly confidence: Extract<AssertionConfidence, "low">;
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
			item.kind !== "community-wiki",
	);

const corroborate = (
	evidence: readonly CorroborationEvidence[],
): CorroborationDecision => {
	const eligible = eligibleEvidence(evidence);
	if (
		eligible.some(
			(item) => item.kind === "scrape" || item.stance === "contradicts",
		)
	) {
		return lowConfidenceDecision;
	}

	const corroborating = eligible
		.filter((item) => item.kind !== "api" || item.validated)
		.map((item) => ({
			item,
			operator: item.operator.trim().toLowerCase(),
		}))
		.filter(({ operator }) => operator.length > 0);
	const operators = new Set(corroborating.map(({ operator }) => operator));
	const hasValidatedApi = corroborating.some(
		({ item }) => item.kind === "api" && item.validated,
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
	ScrapeEvidence,
	SourceStance,
};
