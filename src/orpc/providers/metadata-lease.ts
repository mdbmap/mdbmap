import { and, eq, lte } from "drizzle-orm";

import type { Db } from "@/db";
import type { ContinuityKey } from "@/db/schema";
import { metadataRefreshLease } from "@/db/schema";

import {
	USER_REFRESH_COOLDOWN_MS,
	userRefreshRetryAt,
} from "./metadata-freshness.ts";

type RefreshClaim = { ok: true } | { ok: false; retryAt: Date };

const createD1RefreshLeaseStore = (db: Db) => {
	const get = async (
		continuityKey: ContinuityKey,
	): Promise<Date | undefined> => {
		const row = await db
			.select({ requestedAt: metadataRefreshLease.requestedAt })
			.from(metadataRefreshLease)
			.where(eq(metadataRefreshLease.continuityKey, continuityKey))
			.get();
		return row?.requestedAt;
	};

	const claim = async (
		continuityKey: ContinuityKey,
		now: Date,
	): Promise<RefreshClaim> => {
		const inserted = await db
			.insert(metadataRefreshLease)
			.values({ continuityKey, requestedAt: now })
			.onConflictDoNothing()
			.returning({ requestedAt: metadataRefreshLease.requestedAt })
			.all();
		if (inserted.length > 0) {
			return { ok: true };
		}
		const cutoff = new Date(now.getTime() - USER_REFRESH_COOLDOWN_MS);
		const updated = await db
			.update(metadataRefreshLease)
			.set({ requestedAt: now })
			.where(
				and(
					eq(metadataRefreshLease.continuityKey, continuityKey),
					lte(metadataRefreshLease.requestedAt, cutoff),
				),
			)
			.returning({ requestedAt: metadataRefreshLease.requestedAt })
			.all();
		if (updated.length > 0) {
			return { ok: true };
		}
		const existing = await get(continuityKey);
		const retryAt = userRefreshRetryAt(existing, now) ?? now;
		return { ok: false, retryAt };
	};

	return { claim, get };
};

export { createD1RefreshLeaseStore };
export type { RefreshClaim };
