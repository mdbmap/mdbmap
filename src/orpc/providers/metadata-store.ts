import { and, eq } from "drizzle-orm";

import type { Db } from "@/db";
import type { FreshnessClass, MetadataProviderName } from "@/db/schema";
import { catalogueMetadata } from "@/db/schema";

interface CatalogueMetadataRecord {
	coreFetchedAt: Date;
	coreJson: string;
	entryKey: string;
	freshnessClass: FreshnessClass;
	provider: MetadataProviderName;
	snapshotVersion: number;
	userRefreshedAt: Date | undefined;
	volatileFetchedAt: Date;
	volatileJson: string;
}

interface MetadataStore {
	get: (
		provider: MetadataProviderName,
		entryKey: string,
	) => Promise<CatalogueMetadataRecord | undefined>;
	put: (record: CatalogueMetadataRecord) => Promise<void>;
}

const recordId = (provider: MetadataProviderName, entryKey: string): string =>
	`${provider}:${entryKey}`;

const createMemoryMetadataStore = (): MetadataStore => {
	const rows = new Map<string, CatalogueMetadataRecord>();
	return {
		get: async (provider, entryKey) => {
			await Promise.resolve();
			return rows.get(recordId(provider, entryKey));
		},
		put: async (record) => {
			await Promise.resolve();
			rows.set(recordId(record.provider, record.entryKey), record);
		},
	};
};

const toRecord = (row: {
	coreFetchedAt: Date;
	coreJson: string;
	entryKey: string;
	freshnessClass: FreshnessClass;
	provider: MetadataProviderName;
	snapshotVersion: number;
	userRefreshedAt: Date | null;
	volatileFetchedAt: Date;
	volatileJson: string;
}): CatalogueMetadataRecord => ({
	coreFetchedAt: row.coreFetchedAt,
	coreJson: row.coreJson,
	entryKey: row.entryKey,
	freshnessClass: row.freshnessClass,
	provider: row.provider,
	snapshotVersion: row.snapshotVersion,
	userRefreshedAt: row.userRefreshedAt ?? undefined,
	volatileFetchedAt: row.volatileFetchedAt,
	volatileJson: row.volatileJson,
});

const createD1MetadataStore = (db: Db): MetadataStore => ({
	get: async (provider, entryKey) => {
		const row = await db
			.select()
			.from(catalogueMetadata)
			.where(
				and(
					eq(catalogueMetadata.provider, provider),
					eq(catalogueMetadata.entryKey, entryKey),
				),
			)
			.get();
		return row === undefined ? undefined : toRecord(row);
	},
	put: async (record) => {
		await db
			.insert(catalogueMetadata)
			.values({
				coreFetchedAt: record.coreFetchedAt,
				coreJson: record.coreJson,
				entryKey: record.entryKey,
				freshnessClass: record.freshnessClass,
				provider: record.provider,
				snapshotVersion: record.snapshotVersion,
				userRefreshedAt: record.userRefreshedAt,
				volatileFetchedAt: record.volatileFetchedAt,
				volatileJson: record.volatileJson,
			})
			.onConflictDoUpdate({
				set: {
					coreFetchedAt: record.coreFetchedAt,
					coreJson: record.coreJson,
					freshnessClass: record.freshnessClass,
					snapshotVersion: record.snapshotVersion,
					userRefreshedAt: record.userRefreshedAt,
					volatileFetchedAt: record.volatileFetchedAt,
					volatileJson: record.volatileJson,
				},
				target: [catalogueMetadata.provider, catalogueMetadata.entryKey],
			})
			.run();
	},
});

export { createD1MetadataStore, createMemoryMetadataStore };
export type { CatalogueMetadataRecord, MetadataStore };
