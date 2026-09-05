export type { ContinuityKey, InstalmentLocator } from "@/db/schema";
export { deriveInstalment, deriveLink } from "./derived.ts";
export type { InstalmentNode, UnitCoverage, UnitId } from "./derived.ts";
export { FormatError, formatId, parseId } from "./identity.ts";
export type {
	Identity,
	Locator,
	ParseError,
	ParseErrorReason,
	ParseResult,
	Profile,
	Service,
	TitleIdentity,
	TmdbNamespace,
} from "./identity.ts";
export { serialize, toCompact } from "./serializer.ts";
export type {
	CompactResponse,
	CompletionLink,
	CompletionStatus,
	Counterpart,
	CounterpartError,
	InstalmentAnswer,
	InstalmentError,
	InstalmentMapping,
	Link,
	LinkedConfidence,
	LinkStatus,
	MappingResponse,
	Mappings,
	MatchedLink,
	PathAssertion,
	ResolvedAnswer,
	ResolvedCounterpart,
	ResolvedInstalment,
	ResolvedLink,
	ResolvedLinks,
	TitleAnswer,
} from "./serializer.ts";
export { createEngine } from "./engine.ts";
export { revalidateGroup } from "./revalidation/index.ts";
export type {
	RevalidateGroupInput,
	RevalidateGroupOutcome,
} from "./revalidation/index.ts";
export { noColdLookup, resolveMapping, runMapping } from "./gateway/index.ts";
export type {
	ColdLookup,
	ColdResult,
	GatewayDeps,
	MappingOutcome,
	PendingBuild,
} from "./gateway/index.ts";
export { metadataProviderFor } from "./seam.ts";
export type {
	EngineRead,
	MediaKind,
	MemberTitles,
	MetadataProvider,
	ResolveResult,
	Segment,
} from "./seam.ts";
export { corroborate, resolveResearchSchedule } from "./research/index.ts";
export type {
	CorroborationDecision,
	CorroborationEvidence,
	ResearchSchedule,
} from "./research/index.ts";
