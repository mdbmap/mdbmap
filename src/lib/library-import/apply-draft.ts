import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "@/db";
import { episodeProgress, personalRating, watchStatus } from "@/db/schema";
import type { WatchStatus } from "@/db/schema";
import type { EngineRead, ResolveResult } from "@/engine";
import { instalmentsOf } from "@/orpc/instalments";

import { proposedScoreOf, proposedStatusOf } from "./map-status.ts";
import type {
	ImportDraft,
	ImportListEntry,
	ImportMatchedRow,
	ImportProvider,
} from "./types.ts";

interface AmbiguousResolution {
	readonly continuityId: string;
	readonly externalTitleId: string;
}

interface ApplyImportDraftInput {
	readonly db: Db;
	readonly draft: ImportDraft;
	readonly engine: EngineRead;
	readonly fingerprint: string;
	readonly overwriteLocal?: boolean;
	readonly resolutions?: readonly AmbiguousResolution[];
	readonly userId: string;
}

interface ApplyImportDraftResult {
	readonly applied: number;
	readonly provider: ImportProvider;
	readonly skippedNewerLocal: number;
	readonly skippedUnresolved: number;
	readonly skippedUnmatched: number;
}

type ApplyOutcome = "applied" | "noop" | "skipped_newer";

const remoteMsOf = (entry: ImportListEntry): number | undefined => {
	if (entry.updatedAt === undefined) {
		return undefined;
	}
	const ms = Date.parse(entry.updatedAt);
	return Number.isFinite(ms) ? ms : undefined;
};

const isNewerLocal = (
	localUpdatedAt: Date | null | undefined,
	entry: ImportListEntry,
	overwriteLocal: boolean,
): boolean => {
	if (overwriteLocal) {
		return false;
	}
	if (localUpdatedAt === null || localUpdatedAt === undefined) {
		return false;
	}
	const remoteMs = remoteMsOf(entry);
	if (remoteMs === undefined) {
		return false;
	}
	return localUpdatedAt.getTime() > remoteMs;
};

type ImportDraftBody = Omit<ImportDraft, "fingerprint">;

const fingerprintPayloadOf = (draft: ImportDraftBody): string =>
	JSON.stringify({
		ambiguous: draft.ambiguous.map((row) => ({
			continuityIds: row.continuityIds,
			externalTitleId: row.entry.externalTitleId,
			progress: row.entry.progress,
			score: row.entry.score,
			status: row.entry.status,
			updatedAt: row.entry.updatedAt,
		})),
		matched: draft.matched.map((row) => ({
			continuityId: row.continuityId,
			externalTitleId: row.entry.externalTitleId,
			progress: row.entry.progress,
			score: row.entry.score,
			status: row.entry.status,
			updatedAt: row.entry.updatedAt,
		})),
		provider: draft.provider,
		unmatched: draft.unmatched.map((row) => ({
			externalTitleId: row.entry.externalTitleId,
			reason: row.reason,
		})),
	});

const fingerprintOf = (draft: ImportDraftBody): string => {
	const payload = fingerprintPayloadOf(draft);
	let hash = 2_166_136_261;
	for (let index = 0; index < payload.length; index += 1) {
		const code = payload.codePointAt(index) ?? 0;
		hash = (hash + code * (index + 1)) % 4_294_967_291;
	}
	return hash.toString(16).padStart(8, "0");
};

const withFingerprint = (draft: ImportDraftBody): ImportDraft => ({
	...draft,
	fingerprint: fingerprintOf(draft),
});

const resolutionMapOf = (
	resolutions: readonly AmbiguousResolution[],
): ReadonlyMap<string, string> => {
	const map = new Map<string, string>();
	for (const row of resolutions) {
		map.set(row.externalTitleId, row.continuityId);
	}
	return map;
};

const preferRow = (
	left: ImportMatchedRow,
	right: ImportMatchedRow,
): ImportMatchedRow => {
	const leftMs = remoteMsOf(left.entry) ?? -1;
	const rightMs = remoteMsOf(right.entry) ?? -1;
	if (rightMs !== leftMs) {
		return rightMs > leftMs ? right : left;
	}
	const leftProgress = left.proposedProgress ?? -1;
	const rightProgress = right.proposedProgress ?? -1;
	if (rightProgress !== leftProgress) {
		return rightProgress > leftProgress ? right : left;
	}
	const leftScore = left.proposedScore ?? -1;
	const rightScore = right.proposedScore ?? -1;
	if (rightScore !== leftScore) {
		return rightScore > leftScore ? right : left;
	}
	return left.entry.externalTitleId <= right.entry.externalTitleId
		? left
		: right;
};

const collapseByContinuity = (
	rows: readonly ImportMatchedRow[],
): readonly ImportMatchedRow[] => {
	const byContinuity = new Map<string, ImportMatchedRow>();
	for (const row of rows) {
		const prior = byContinuity.get(row.continuityId);
		byContinuity.set(
			row.continuityId,
			prior === undefined ? row : preferRow(prior, row),
		);
	}
	return [...byContinuity.values()].toSorted((left, right) =>
		left.continuityId.localeCompare(right.continuityId),
	);
};

const rowsToApply = (
	draft: ImportDraft,
	resolutions: readonly AmbiguousResolution[],
): {
	readonly rows: readonly ImportMatchedRow[];
	readonly skippedUnresolved: number;
	readonly skippedUnmatched: number;
} => {
	const byExternal = resolutionMapOf(resolutions);
	const rows: ImportMatchedRow[] = [...draft.matched];
	let skippedUnresolved = 0;
	for (const ambiguous of draft.ambiguous) {
		const chosen = byExternal.get(ambiguous.entry.externalTitleId);
		if (chosen === undefined || !ambiguous.continuityIds.includes(chosen)) {
			skippedUnresolved += 1;
			continue;
		}
		rows.push({
			continuityId: chosen,
			entry: ambiguous.entry,
			proposedProgress: ambiguous.entry.progress,
			proposedScore: proposedScoreOf(ambiguous.entry.score),
			proposedStatus: proposedStatusOf(ambiguous.entry),
		});
	}
	return {
		rows: collapseByContinuity(rows),
		skippedUnmatched: draft.unmatched.length,
		skippedUnresolved,
	};
};

const applyStatus = async (
	db: Db,
	userId: string,
	continuityId: string,
	status: WatchStatus | undefined,
	entry: ImportListEntry,
	overwriteLocal: boolean,
): Promise<ApplyOutcome> => {
	if (status === undefined) {
		return "noop";
	}
	const existing = await db
		.select({
			status: watchStatus.status,
			updatedAt: watchStatus.updatedAt,
		})
		.from(watchStatus)
		.where(
			and(
				eq(watchStatus.userId, userId),
				eq(watchStatus.continuityKey, continuityId),
			),
		)
		.get();
	if (isNewerLocal(existing?.updatedAt, entry, overwriteLocal)) {
		return "skipped_newer";
	}
	if (existing?.status === status) {
		return "noop";
	}
	const updatedAt = new Date();
	await db
		.insert(watchStatus)
		.values({ continuityKey: continuityId, status, updatedAt, userId })
		.onConflictDoUpdate({
			set: { status, updatedAt },
			target: [watchStatus.userId, watchStatus.continuityKey],
		})
		.run();
	return "applied";
};

const applyScore = async (
	db: Db,
	userId: string,
	continuityId: string,
	score: number | undefined,
	entry: ImportListEntry,
	overwriteLocal: boolean,
): Promise<ApplyOutcome> => {
	if (score === undefined) {
		return "noop";
	}
	const existing = await db
		.select({
			score: personalRating.score,
			updatedAt: personalRating.updatedAt,
		})
		.from(personalRating)
		.where(
			and(
				eq(personalRating.userId, userId),
				eq(personalRating.unitKind, "work"),
				eq(personalRating.unitKey, continuityId),
			),
		)
		.get();
	if (isNewerLocal(existing?.updatedAt, entry, overwriteLocal)) {
		return "skipped_newer";
	}
	if (existing?.score === score) {
		return "noop";
	}
	const updatedAt = new Date();
	await db
		.insert(personalRating)
		.values({
			score,
			unitKey: continuityId,
			unitKind: "work",
			updatedAt,
			userId,
		})
		.onConflictDoUpdate({
			set: { score, updatedAt },
			target: [
				personalRating.userId,
				personalRating.unitKind,
				personalRating.unitKey,
			],
		})
		.run();
	return "applied";
};

const locatorsForEntry = (
	resolved: ResolveResult,
	provider: ImportProvider,
	externalTitleId: string,
): readonly string[] => {
	const segment = resolved.segments.find(
		(candidate) => candidate.members[provider] === externalTitleId,
	);
	if (segment === undefined) {
		return [];
	}
	return segment.instalments;
};

const applyProgress = async (
	db: Db,
	engine: EngineRead,
	userId: string,
	provider: ImportProvider,
	continuityId: string,
	progress: number | undefined,
	entry: ImportListEntry,
	overwriteLocal: boolean,
): Promise<ApplyOutcome> => {
	if (progress === undefined || progress <= 0) {
		return "noop";
	}
	const resolved = await engine.resolveContinuity(continuityId);
	const segmentLocators = locatorsForEntry(
		resolved,
		provider,
		entry.externalTitleId,
	);
	const locators =
		segmentLocators.length === 0 ? instalmentsOf(resolved) : segmentLocators;
	const target = locators.slice(0, progress);
	if (target.length === 0) {
		return "noop";
	}
	const already = await db
		.select({
			locator: episodeProgress.instalmentLocator,
			watchedAt: episodeProgress.watchedAt,
		})
		.from(episodeProgress)
		.where(
			and(
				eq(episodeProgress.userId, userId),
				inArray(episodeProgress.instalmentLocator, target),
			),
		)
		.all();
	if (!overwriteLocal) {
		const remoteMs = remoteMsOf(entry);
		if (remoteMs !== undefined) {
			let newestLocal: number | undefined;
			for (const row of already) {
				if (row.watchedAt === null || row.watchedAt === undefined) {
					continue;
				}
				const ms = row.watchedAt.getTime();
				if (newestLocal === undefined || ms > newestLocal) {
					newestLocal = ms;
				}
			}
			if (newestLocal !== undefined && newestLocal > remoteMs) {
				return "skipped_newer";
			}
		}
	}
	const watched = new Set(already.map((row) => row.locator));
	const missing = target.filter((locator) => !watched.has(locator));
	if (missing.length === 0) {
		return "noop";
	}
	const watchedAt = new Date(remoteMsOf(entry) ?? Date.now());
	await db
		.insert(episodeProgress)
		.values(
			missing.map((instalmentLocator) => ({
				instalmentLocator,
				userId,
				watchedAt,
			})),
		)
		.onConflictDoNothing()
		.run();
	return "applied";
};

const applyImportDraft = async (
	input: ApplyImportDraftInput,
): Promise<ApplyImportDraftResult> => {
	const expected = fingerprintOf(input.draft);
	if (input.fingerprint !== expected) {
		throw new Error("import: draft fingerprint mismatch");
	}
	const overwriteLocal = input.overwriteLocal === true;
	const prepared = rowsToApply(input.draft, input.resolutions ?? []);
	const outcomes = await Promise.all(
		prepared.rows.map(async (row) => {
			const statusResult = await applyStatus(
				input.db,
				input.userId,
				row.continuityId,
				row.proposedStatus,
				row.entry,
				overwriteLocal,
			);
			const scoreResult = await applyScore(
				input.db,
				input.userId,
				row.continuityId,
				row.proposedScore,
				row.entry,
				overwriteLocal,
			);
			const progressResult =
				statusResult === "skipped_newer"
					? ("skipped_newer" as const)
					: await applyProgress(
							input.db,
							input.engine,
							input.userId,
							input.draft.provider,
							row.continuityId,
							row.proposedProgress,
							row.entry,
							overwriteLocal,
						);
			return { progressResult, scoreResult, statusResult };
		}),
	);

	let applied = 0;
	let skippedNewerLocal = 0;
	for (const outcome of outcomes) {
		const skipped =
			outcome.statusResult === "skipped_newer" ||
			outcome.scoreResult === "skipped_newer" ||
			outcome.progressResult === "skipped_newer";
		if (skipped) {
			skippedNewerLocal += 1;
		}
		if (
			outcome.statusResult === "applied" ||
			outcome.scoreResult === "applied" ||
			outcome.progressResult === "applied"
		) {
			applied += 1;
		}
	}

	return {
		applied,
		provider: input.draft.provider,
		skippedNewerLocal,
		skippedUnmatched: prepared.skippedUnmatched,
		skippedUnresolved: prepared.skippedUnresolved,
	};
};

export { applyImportDraft, fingerprintOf, withFingerprint };
export type {
	AmbiguousResolution,
	ApplyImportDraftInput,
	ApplyImportDraftResult,
};
