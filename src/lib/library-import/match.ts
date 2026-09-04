import { and, asc, eq, inArray } from "drizzle-orm";

import type { Db } from "@/db";
import {
	continuityAliases,
	continuitySegments,
	serviceTitles,
} from "@/db/engine-schema";
import { continuityKey } from "@/engine/continuity/keys";

import { withFingerprint } from "./apply-draft.ts";
import { proposedScoreOf, proposedStatusOf } from "./map-status.ts";
import type {
	ImportAmbiguousRow,
	ImportDraft,
	ImportListEntry,
	ImportMatchedRow,
	ImportProvider,
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

const mergeContinuities = (
	byExternal: Map<string, string[]>,
	serviceId: string,
	keys: readonly string[],
): void => {
	const prior = byExternal.get(serviceId) ?? [];
	byExternal.set(serviceId, [...new Set([...prior, ...keys])]);
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

const loadContinuityPage = async (
	db: Db,
	service: ImportProvider,
	slice: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> => {
	const byExternal = new Map<string, string[]>();
	const titleRows = await db
		.select({
			serviceId: serviceTitles.serviceId,
			titleId: serviceTitles.id,
		})
		.from(serviceTitles)
		.where(
			and(
				eq(serviceTitles.service, service),
				inArray(serviceTitles.serviceId, slice),
			),
		)
		.all();
	if (titleRows.length === 0) {
		return byExternal;
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
			byExternal.set(title.serviceId, byExternal.get(title.serviceId) ?? []);
			continue;
		}
		mergeContinuities(
			byExternal,
			title.serviceId,
			rawIds.map((id) => continuityKey(survivors.get(id) ?? id)),
		);
	}

	return byExternal;
};

const continuityIdsForExternalIds = async (
	db: Db,
	service: ImportProvider,
	externalIds: readonly string[],
): Promise<ReadonlyMap<string, readonly string[]>> => {
	const byExternal = new Map<string, string[]>();
	if (externalIds.length === 0) {
		return byExternal;
	}

	const pages = await Promise.all(
		chunked([...new Set(externalIds)], CHUNK).map(async (slice) =>
			loadContinuityPage(db, service, slice),
		),
	);
	for (const page of pages) {
		for (const [serviceId, keys] of page) {
			mergeContinuities(byExternal, serviceId, keys);
		}
	}
	return byExternal;
};

const matchImportEntries = async (
	db: Db,
	provider: ImportProvider,
	entries: readonly ImportListEntry[],
): Promise<ImportDraft> => {
	const continuityByExternal = await continuityIdsForExternalIds(
		db,
		provider,
		entries.map((entry) => entry.externalTitleId),
	);

	const matched: ImportMatchedRow[] = [];
	const ambiguous: ImportAmbiguousRow[] = [];
	const unmatched: ImportUnmatchedRow[] = [];

	for (const entry of entries) {
		const known = continuityByExternal.has(entry.externalTitleId);
		const continuityIds = continuityByExternal.get(entry.externalTitleId) ?? [];
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

	return withFingerprint({
		ambiguous,
		matched,
		provider,
		unmatched,
	});
};

const matchMalEntries = async (
	db: Db,
	entries: readonly ImportListEntry[],
): Promise<ImportDraft> => matchImportEntries(db, "mal", entries);

const matchAnilistEntries = async (
	db: Db,
	entries: readonly ImportListEntry[],
): Promise<ImportDraft> => matchImportEntries(db, "anilist", entries);

export { matchAnilistEntries, matchImportEntries, matchMalEntries };
