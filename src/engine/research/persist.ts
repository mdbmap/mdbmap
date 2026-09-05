import { and, eq } from "drizzle-orm";

import { one } from "@/db";
import type { Db } from "@/db";
import { serviceInstalments, serviceTitles } from "@/db/engine-schema";

import type { ResearchCatalogueRecord } from "./catalogue.ts";

const ROW_MISSING = "research persist: expected an inserted row";

interface ServiceRef {
	readonly service: string;
	readonly serviceId: string;
}

interface PersistedSpoke {
	readonly instalmentId: number;
	readonly locator: string;
}

interface PersistedTitle {
	readonly spokes: readonly PersistedSpoke[];
	readonly titleId: number;
}

const findTitle = async (
	db: Db,
	ref: ServiceRef,
): Promise<number | undefined> => {
	const rows = await db
		.select({ id: serviceTitles.id })
		.from(serviceTitles)
		.where(
			and(
				eq(serviceTitles.service, ref.service),
				eq(serviceTitles.serviceId, ref.serviceId),
			),
		)
		.all();
	return rows[0]?.id;
};

const nextOrdinalForGroup = async (
	db: Db,
	groupId: number,
): Promise<number> => {
	const ordinalRows = await db
		.select({ ordinal: serviceTitles.ordinal })
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, groupId))
		.all();
	let highest = -1;
	for (const row of ordinalRows) {
		if (row.ordinal > highest) {
			highest = row.ordinal;
		}
	}
	return highest + 1;
};

const ensureTitle = async (
	db: Db,
	groupId: number,
	ref: ServiceRef,
): Promise<number> => {
	const existing = await findTitle(db, ref);
	if (existing !== undefined) {
		return existing;
	}
	return one(
		await db
			.insert(serviceTitles)
			.values({
				groupId,
				ordinal: await nextOrdinalForGroup(db, groupId),
				service: ref.service,
				serviceId: ref.serviceId,
			})
			.returning()
			.all(),
		ROW_MISSING,
	).id;
};

const existingSpokesForTitle = async (
	db: Db,
	titleId: number,
): Promise<Map<string, number>> => {
	const rows = await db
		.select({
			id: serviceInstalments.id,
			locator: serviceInstalments.locator,
		})
		.from(serviceInstalments)
		.where(eq(serviceInstalments.titleId, titleId))
		.all();
	return new Map(rows.map((row) => [row.locator, row.id]));
};

const insertMissingSpokes = async (
	db: Db,
	titleId: number,
	record: ResearchCatalogueRecord,
	existing: ReadonlyMap<string, number>,
): Promise<readonly PersistedSpoke[]> => {
	const missing = record.instalments.filter(
		(instalment) => !existing.has(instalment.locator),
	);
	const inserted = await Promise.all(
		missing.map(async (instalment) =>
			one(
				await db
					.insert(serviceInstalments)
					.values({
						locator: instalment.locator,
						locatorKind: instalment.locatorKind,
						titleId,
					})
					.returning()
					.all(),
				ROW_MISSING,
			),
		),
	);
	const byLocator = new Map(existing);
	for (const row of inserted) {
		byLocator.set(row.locator, row.id);
	}
	return record.instalments.flatMap((instalment) => {
		const instalmentId = byLocator.get(instalment.locator);
		return instalmentId === undefined
			? []
			: [{ instalmentId, locator: instalment.locator }];
	});
};

// Upsert the catalogue title into the continuity's group and materialise every
// instalment the validated tool output already carried as spokes. Acceptance
// later reads these rows — it does not re-fetch the upstream.
const persistCatalogueSpokes = async (
	db: Db,
	groupId: number,
	ref: ServiceRef,
	record: ResearchCatalogueRecord,
): Promise<PersistedTitle> => {
	const titleId = await ensureTitle(db, groupId, ref);
	const existing = await existingSpokesForTitle(db, titleId);
	const spokes = await insertMissingSpokes(db, titleId, record, existing);
	return { spokes, titleId };
};

export { findTitle, persistCatalogueSpokes };
export type { PersistedSpoke, PersistedTitle, ServiceRef };
