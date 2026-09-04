import { and, asc, eq, inArray } from "drizzle-orm";

import type { Db } from "@/db";
import {
	continuityAliases,
	continuitySegments,
	serviceTitles,
} from "@/db/engine-schema";
import { continuityKey } from "@/engine/continuity/keys";

import { proposedScoreOf, proposedStatusOf } from "./map-status.ts";
import type {
	ImportAmbiguousRow,
	ImportDraft,
	ImportListEntry,
	ImportMatchedRow,
	ImportUnmatchedRow,
} from "./types.ts";

const CHUNK = 50;

const chunked = <T>(items: readonly T[], size: number): T[][] => {
	const out: T[][] = [];
	for (let offset = 0; offset < items.length; offset += size) {
		out.push(items.slice(offset, offset + size));
	}
	return out;
};

const mergeMalContinuities = (
	byMal: Map<string, string[]>,
	serviceId: string,
	keys: readonly string[],
): void => {
	const prior = byMal.get(serviceId) ?? [];
	byMal.set(serviceId, [...new Set([...prior, ...keys])]);
};

const loadSurvivorByRetired = async (
	db: Db,
	continuityIds: readonly number[],
): Promise<ReadonlyMap<number, number>> => {
	const survivors = new Map<number, number>();
	for (const id of continuityIds) {
		survivors.set(id, id);
	}
	const uniqueIds = [...new Set(continuityIds)];
	if (uniqueIds.length === 0) {
		return survivors;
	}
	const pages = await Promise.all(
		chunked(uniqueIds, CHUNK).map(async (slice) =>
			db
				.select({
					retiredContinuityId: continuityAliases.retiredContinuityId,
					survivorContinuityId: continuityAliases.survivorContinuityId,
				})
				.from(continuityAliases)
				.where(inArray(continuityAliases.retiredContinuityId, slice))
				.all(),
		),
	);
	for (const rows of pages) {
		for (const row of rows) {
			survivors.set(row.retiredContinuityId, row.survivorContinuityId);
		}
	}
	return survivors;
};

const loadSegmentRows = async (
	db: Db,
	titleIds: readonly number[],
): Promise<readonly { continuityId: number; titleId: number }[]> => {
	if (titleIds.length === 0) {
		return [];
	}
	const pages = await Promise.all(
		chunked(titleIds, CHUNK).map(async (slice) =>
			db
				.select({
					continuityId: continuitySegments.continuityId,
					titleId: continuitySegments.titleId,
				})
				.from(continuitySegments)
				.where(inArray(continuitySegments.titleId, slice))
				.orderBy(asc(continuitySegments.continuityId))
				.all(),
		),
	);
	return pages.flat();
};

const loadMalContinuityPage = async (
	db: Db,
	slice: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> => {
	const byMal = new Map<string, string[]>();
	const titleRows = await db
		.select({
			serviceId: serviceTitles.serviceId,
			titleId: serviceTitles.id,
		})
		.from(serviceTitles)
		.where(
			and(
				eq(serviceTitles.service, "mal"),
				inArray(serviceTitles.serviceId, slice),
			),
		)
		.all();
	if (titleRows.length === 0) {
		return byMal;
	}

	const titleIds = titleRows.map((row) => row.titleId);
	const segmentRows = await loadSegmentRows(db, titleIds);

	const continuityByTitle = new Map<number, number[]>();
	const rawContinuityIds: number[] = [];
	for (const row of segmentRows) {
		const existing = continuityByTitle.get(row.titleId) ?? [];
		existing.push(row.continuityId);
		continuityByTitle.set(row.titleId, existing);
		rawContinuityIds.push(row.continuityId);
	}

	const survivors = await loadSurvivorByRetired(db, rawContinuityIds);

	for (const title of titleRows) {
		const rawIds = continuityByTitle.get(title.titleId) ?? [];
		if (rawIds.length === 0) {
			byMal.set(title.serviceId, byMal.get(title.serviceId) ?? []);
			continue;
		}
		mergeMalContinuities(
			byMal,
			title.serviceId,
			rawIds.map((id) => continuityKey(survivors.get(id) ?? id)),
		);
	}

	return byMal;
};

const continuityIdsForMalIds = async (
	db: Db,
	malIds: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> => {
	const byMal = new Map<string, string[]>();
	if (malIds.length === 0) {
		return byMal;
	}

	const pages = await Promise.all(
		chunked([...new Set(malIds)], CHUNK).map(async (slice) =>
			loadMalContinuityPage(db, slice),
		),
	);
	for (const page of pages) {
		for (const [serviceId, keys] of page) {
			mergeMalContinuities(byMal, serviceId, keys);
		}
	}
	return byMal;
};

const matchMalEntries = async (
	db: Db,
	entries: readonly ImportListEntry[],
): Promise<ImportDraft> => {
	const continuityByMal = await continuityIdsForMalIds(
		db,
		entries.map((entry) => entry.externalTitleId),
	);

	const matched: ImportMatchedRow[] = [];
	const ambiguous: ImportAmbiguousRow[] = [];
	const unmatched: ImportUnmatchedRow[] = [];

	for (const entry of entries) {
		const known = continuityByMal.has(entry.externalTitleId);
		const continuityIds = continuityByMal.get(entry.externalTitleId) ?? [];
		if (!known) {
			unmatched.push({ entry, reason: "no_service_title" });
			continue;
		}
		if (continuityIds.length === 0) {
			unmatched.push({ entry, reason: "no_continuity" });
			continue;
		}
		if (continuityIds.length > 1) {
			ambiguous.push({ continuityIds, entry });
			continue;
		}
		const [continuityId] = continuityIds;
		if (continuityId === undefined) {
			unmatched.push({ entry, reason: "no_continuity" });
			continue;
		}
		matched.push({
			continuityId,
			entry,
			proposedProgress: entry.progress,
			proposedScore: proposedScoreOf(entry.score),
			proposedStatus: proposedStatusOf(entry),
		});
	}

	return {
		ambiguous,
		matched,
		provider: "mal",
		unmatched,
	};
};

export { matchMalEntries };
