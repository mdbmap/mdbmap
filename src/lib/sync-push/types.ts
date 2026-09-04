import type { SyncAccountProvider } from "@/db/schema";

type UnmappedReason =
	| "no_member_title"
	| "unmapped_instalment"
	| "unsupported_provider_mapping";

interface UnmappedWarning {
	readonly continuityId: string;
	readonly instalmentLocator?: string;
	readonly kind: "instalment" | "rating_unit" | "segment";
	readonly provider?: SyncAccountProvider;
	readonly reason: UnmappedReason;
	readonly segmentIndex?: number;
}

interface TargetPushCounts {
	readonly progress: number;
	readonly ratings: number;
	readonly status: number;
}

interface TargetPushSuccess {
	readonly counts: TargetPushCounts;
	readonly cursor: string;
	readonly ok: true;
	readonly provider: SyncAccountProvider;
}

interface TargetPushFailure {
	readonly counts: TargetPushCounts;
	readonly error: string;
	readonly ok: false;
	readonly provider: SyncAccountProvider;
}

type TargetPushResult = TargetPushFailure | TargetPushSuccess;

interface PushResult {
	readonly continuityId: string;
	readonly targets: readonly TargetPushResult[];
	readonly warningCount: number;
	readonly warnings: readonly UnmappedWarning[];
}

type MappedWatchStatus =
	| "completed"
	| "current"
	| "dropped"
	| "on_hold"
	| "repeating";

interface StatusWrite {
	readonly externalTitleId: string;
	readonly status: MappedWatchStatus;
}

interface ProgressWrite {
	readonly episode: number;
	readonly externalTitleId: string;
	readonly watched: boolean;
}

interface RatingWrite {
	readonly episode?: number;
	readonly externalTitleId: string;
	readonly score: number;
	readonly unit: "episode" | "title";
}

interface TargetWriteBatch {
	readonly progress: readonly ProgressWrite[];
	readonly ratings: readonly RatingWrite[];
	readonly status: readonly StatusWrite[];
}

interface SyncTargetClient {
	readonly provider: SyncAccountProvider;
	push: (batch: TargetWriteBatch) => Promise<void>;
}

export type {
	MappedWatchStatus,
	ProgressWrite,
	PushResult,
	RatingWrite,
	StatusWrite,
	SyncTargetClient,
	TargetPushCounts,
	TargetPushResult,
	TargetWriteBatch,
	UnmappedWarning,
};
