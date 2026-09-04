import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "@/db";
import type { ContinuityKey, SyncAccountProvider } from "@/db/schema";
import { episodeProgress, personalRating, watchStatus } from "@/db/schema";
import type { EngineRead } from "@/engine";
import type { SyncAccountCredentials } from "@/lib/sync-accounts";
import {
	listSyncAccounts,
	readSyncAccountCredentials,
	recordSyncAccountError,
	updateSyncAccountCursor,
} from "@/lib/sync-accounts";
import { instalmentsOf } from "@/orpc/instalments";

import { createTargetClient } from "./clients/index.ts";
import { mapContinuity } from "./map-continuity.ts";
import type { TrackingSnapshot } from "./map-continuity.ts";
import type {
	PushResult,
	SyncTargetClient,
	TargetPushCounts,
	TargetPushResult,
	TargetWriteBatch,
} from "./types.ts";

interface SyncPushStore {
	readonly listAccounts: typeof listSyncAccounts;
	readonly readCredentials: typeof readSyncAccountCredentials;
	readonly recordError: typeof recordSyncAccountError;
	readonly updateCursor: typeof updateSyncAccountCursor;
}

interface PushContinuityInput {
	readonly continuityId: ContinuityKey;
	readonly createClient?: (
		provider: SyncAccountProvider,
		credentials: SyncAccountCredentials,
	) => SyncTargetClient;
	readonly db: Db;
	readonly engine: EngineRead;
	readonly masterKeyBase64: string;
	readonly store?: SyncPushStore;
	readonly tracking?: TrackingSnapshot;
	readonly userId: string;
}

const defaultStore: SyncPushStore = {
	listAccounts: listSyncAccounts,
	readCredentials: readSyncAccountCredentials,
	recordError: recordSyncAccountError,
	updateCursor: updateSyncAccountCursor,
};

const emptyCounts = (): TargetPushCounts => ({
	progress: 0,
	ratings: 0,
	status: 0,
});

const countsOf = (batch: TargetWriteBatch): TargetPushCounts => ({
	progress: batch.progress.length,
	ratings: batch.ratings.length,
	status: batch.status.length,
});

const ratingBelongs = (
	row: { unitKey: string; unitKind: string },
	continuityId: ContinuityKey,
	locators: ReadonlySet<string>,
): boolean => {
	if (row.unitKind === "work") {
		return row.unitKey === continuityId;
	}
	if (row.unitKind === "part") {
		return row.unitKey.startsWith(`part:${continuityId}:`);
	}
	if (row.unitKind === "episode" || row.unitKind === "movie") {
		return locators.has(row.unitKey);
	}
	return false;
};

const loadTracking = async (
	db: Db,
	userId: string,
	continuityId: ContinuityKey,
	locators: readonly string[],
): Promise<TrackingSnapshot> => {
	const locatorSet = new Set(locators);
	const statusRow = await db
		.select({ status: watchStatus.status })
		.from(watchStatus)
		.where(
			and(
				eq(watchStatus.userId, userId),
				eq(watchStatus.continuityKey, continuityId),
			),
		)
		.get();

	const watchedRows =
		locators.length === 0
			? []
			: await db
					.select({ locator: episodeProgress.instalmentLocator })
					.from(episodeProgress)
					.where(
						and(
							eq(episodeProgress.userId, userId),
							inArray(episodeProgress.instalmentLocator, [...locators]),
						),
					)
					.all();

	const ratingRows = await db
		.select({
			score: personalRating.score,
			unitKey: personalRating.unitKey,
			unitKind: personalRating.unitKind,
		})
		.from(personalRating)
		.where(eq(personalRating.userId, userId))
		.all();

	return {
		episodeWatched: new Set(watchedRows.map((row) => row.locator)),
		ratings: ratingRows
			.filter((row) => ratingBelongs(row, continuityId, locatorSet))
			.map((row) => ({
				score: row.score,
				unitKey: row.unitKey,
				unitKind: row.unitKind,
			})),
		status: statusRow?.status,
	};
};

const pushOneTarget = async (input: {
	readonly batch: TargetWriteBatch;
	readonly continuityId: ContinuityKey;
	readonly createClient: NonNullable<PushContinuityInput["createClient"]>;
	readonly db: Db;
	readonly masterKeyBase64: string;
	readonly provider: SyncAccountProvider;
	readonly store: SyncPushStore;
	readonly userId: string;
}): Promise<TargetPushResult> => {
	const {
		batch,
		continuityId,
		createClient,
		db,
		masterKeyBase64,
		provider,
		store,
		userId,
	} = input;

	const credentials = await store.readCredentials(
		db,
		masterKeyBase64,
		userId,
		provider,
	);
	if (credentials === undefined) {
		const error = "Linked account credentials are unavailable.";
		await store.recordError(db, userId, provider, error);
		return { counts: emptyCounts(), error, ok: false, provider };
	}

	const counts = countsOf(batch);
	try {
		await createClient(provider, credentials).push(batch);
		const cursor = `${continuityId}@${new Date().toISOString()}`;
		await store.updateCursor(db, userId, provider, cursor);
		return { counts, cursor, ok: true, provider };
	} catch (error) {
		const message =
			error instanceof Error ? error.message : "Target push failed.";
		await store.recordError(db, userId, provider, message);
		return { counts, error: message, ok: false, provider };
	}
};

const pushContinuity = async (
	input: PushContinuityInput,
): Promise<PushResult> => {
	const store = input.store ?? defaultStore;
	const accounts = await store.listAccounts(input.db, input.userId);
	const providers = accounts.map(({ provider }) => provider);
	const resolved = await input.engine.resolveContinuity(input.continuityId);
	const { continuityId } = resolved;
	const locators = instalmentsOf(resolved);
	const tracking =
		input.tracking ??
		(await loadTracking(input.db, input.userId, continuityId, locators));
	const mapped = mapContinuity({
		continuityId,
		providers,
		resolved,
		tracking,
	});
	const createClient = input.createClient ?? createTargetClient;

	const targets = await Promise.all(
		mapped.targets.map(async ({ batch, provider }) =>
			pushOneTarget({
				batch,
				continuityId,
				createClient,
				db: input.db,
				masterKeyBase64: input.masterKeyBase64,
				provider,
				store,
				userId: input.userId,
			}),
		),
	);

	return {
		continuityId,
		targets,
		warningCount: mapped.warnings.length,
		warnings: mapped.warnings,
	};
};

export { pushContinuity };
export type { PushContinuityInput, SyncPushStore };
