import type { ContinuityKey, InstalmentLocator } from "@/db/schema";

type MediaKind = "anime" | "film" | "tv";

type MetadataProvider = "anidb" | "tmdb";

interface MemberTitles {
	anidb?: string;
	anilist?: string;
	mal?: string;
	tmdb?: string;
}

interface Segment {
	instalments: readonly InstalmentLocator[];
	members: MemberTitles;
}

interface ResolveResult {
	mediaKind: MediaKind;
	segments: readonly Segment[];
}

// The real resolver is the mapping engine's job (ADR-0001/0002); swapping the
// engine in must not change this contract. Async because the runtime db is D1.
interface EngineRead {
	resolveContinuity: (continuityId: ContinuityKey) => Promise<ResolveResult>;
}

const metadataProviderFor = (kind: MediaKind): MetadataProvider =>
	kind === "anime" ? "anidb" : "tmdb";

export { metadataProviderFor };
export type {
	EngineRead,
	MediaKind,
	MemberTitles,
	MetadataProvider,
	ResolveResult,
	Segment,
};
