import type { WatchStatus } from "@/db/schema";

type ImportProvider = "anilist" | "mal";

interface ImportListEntry {
	readonly externalTitleId: string;
	readonly progress: number | undefined;
	readonly score: number | undefined;
	readonly status: string;
	readonly title: string | undefined;
	readonly updatedAt: string | undefined;
}

interface ImportMatchedRow {
	readonly continuityId: string;
	readonly entry: ImportListEntry;
	readonly proposedProgress: number | undefined;
	readonly proposedScore: number | undefined;
	readonly proposedStatus: WatchStatus | undefined;
}

interface ImportAmbiguousRow {
	readonly continuityIds: readonly string[];
	readonly entry: ImportListEntry;
}

interface ImportUnmatchedRow {
	readonly entry: ImportListEntry;
	readonly reason: "no_continuity" | "no_service_title";
}

interface ImportDraft {
	readonly ambiguous: readonly ImportAmbiguousRow[];
	readonly matched: readonly ImportMatchedRow[];
	readonly provider: ImportProvider;
	readonly unmatched: readonly ImportUnmatchedRow[];
}

export type {
	ImportAmbiguousRow,
	ImportDraft,
	ImportListEntry,
	ImportMatchedRow,
	ImportProvider,
	ImportUnmatchedRow,
};
