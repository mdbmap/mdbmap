export { createBudget } from "./budget.ts";
export type { BudgetLedger, BudgetSnapshot } from "./budget.ts";
export { alignStreams } from "./framework.ts";
export type {
	AlignedPair,
	AlignInput,
	AlignmentOutcome,
	PublishedAlignment,
	ReusedLocator,
	SideDisposition,
	StrayLocator,
	TierLink,
} from "./framework.ts";
export {
	instalmentKinds,
	mainSequence,
	streamBoundaries,
} from "./instalment.ts";
export type {
	Instalment,
	InstalmentKind,
	InstalmentStream,
	MainSequenceEntry,
	StreamBoundary,
} from "./instalment.ts";
export { runLadder, tierIds } from "./ladder.ts";
export type {
	LadderInput,
	LadderResult,
	LadderTiers,
	Tier,
	TierContext,
	TierContribution,
	TierId,
	TierProposal,
} from "./ladder.ts";
export { checkMonotonic, indexStream } from "./monotonic.ts";
export type {
	CandidatePairing,
	Crossing,
	MatchingOrder,
	MonotonicVerdict,
	NonEmptyArray,
	StreamIndex,
} from "./monotonic.ts";
export { createT1StructureTier } from "./t1-structure.ts";
export type {
	T1Input,
	T1Instalment,
	T1Segment,
	T1Side,
} from "./t1-structure.ts";
export { createT2PatternTier } from "./t2-pattern.ts";
export type {
	EpisodeGroupOrdering,
	EpisodeGroupProvider,
	EpisodeGroupSummary,
	T2Input,
	T2Instalment,
	T2Segment,
	T2Side,
} from "./t2-pattern.ts";
export { createTier3, matchTier3 } from "./tier3.ts";
export type {
	FactsByLocator,
	InstalmentFacts,
	Tier3Input,
	Tier3Link,
	Tier3Result,
} from "./tier3.ts";
export {
	dayDistance,
	editDistance,
	normaliseTitle,
	TITLE_AGREEMENT,
	titleSimilarity,
	tokenOverlap,
} from "./tier3-scoring.ts";
