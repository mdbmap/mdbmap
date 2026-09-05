import type { FreshnessClass, MetadataProviderName } from "@/db/schema";

import type { Snapshots } from "./metadata-document.ts";
import {
	coreSnapshotSchema,
	parseSnapshot,
	volatileSnapshotSchema,
} from "./metadata-document.ts";
import type {
	MetadataFetchOptions,
	SnapshotNeed,
} from "./metadata-freshness.ts";
import {
	freshnessClassOf,
	laterDate,
	planRefresh,
} from "./metadata-freshness.ts";
import type {
	CatalogueMetadataRecord,
	MetadataStore,
} from "./metadata-store.ts";

interface LoadedDocument {
	coreFetchedAt: Date;
	freshnessClass: FreshnessClass;
	snapshots: Snapshots;
	volatileFetchedAt: Date;
}

const parseStored = (
	row: CatalogueMetadataRecord,
	version: number,
): LoadedDocument | undefined => {
	if (row.snapshotVersion !== version) {
		return undefined;
	}
	const core = parseSnapshot(row.coreJson, coreSnapshotSchema);
	const volatile = parseSnapshot(row.volatileJson, volatileSnapshotSchema);
	if (core === undefined || volatile === undefined) {
		return undefined;
	}
	if (core.version !== version || volatile.version !== version) {
		return undefined;
	}
	return {
		coreFetchedAt: row.coreFetchedAt,
		freshnessClass: row.freshnessClass,
		snapshots: { core, volatile },
		volatileFetchedAt: row.volatileFetchedAt,
	};
};

const persist = async (
	store: MetadataStore,
	provider: MetadataProviderName,
	entryKey: string,
	version: number,
	now: Date,
	snapshots: Snapshots,
	freshnessClass: FreshnessClass,
	need: SnapshotNeed,
	force: boolean,
	previous: LoadedDocument | undefined,
	previousRow: CatalogueMetadataRecord | undefined,
): Promise<LoadedDocument> => {
	const coreFetchedAt = need.fetchCore ? now : (previous?.coreFetchedAt ?? now);
	const volatileFetchedAt = need.fetchVolatile
		? now
		: (previous?.volatileFetchedAt ?? now);
	const record: CatalogueMetadataRecord = {
		coreFetchedAt,
		coreJson: JSON.stringify(snapshots.core),
		entryKey,
		freshnessClass,
		provider,
		snapshotVersion: version,
		userRefreshedAt: force ? now : previousRow?.userRefreshedAt,
		volatileFetchedAt,
		volatileJson: JSON.stringify(snapshots.volatile),
	};
	await store.put(record);
	return {
		coreFetchedAt,
		freshnessClass,
		snapshots,
		volatileFetchedAt,
	};
};

const resolveCatalogueDocument = async ({
	entryKey,
	fetchSnapshots,
	now,
	options,
	provider,
	store,
	version,
}: {
	entryKey: string;
	fetchSnapshots: (
		need: SnapshotNeed,
		previous: Snapshots | undefined,
	) => Snapshots | Promise<Snapshots>;
	now: Date;
	options: MetadataFetchOptions;
	provider: MetadataProviderName;
	store: MetadataStore;
	version: number;
}): Promise<LoadedDocument> => {
	const storedRow = await store.get(provider, entryKey);
	const stored =
		storedRow === undefined ? undefined : parseStored(storedRow, version);
	const plan = planRefresh({
		force: options.force === true,
		freshnessClass: stored?.freshnessClass ?? "continuing",
		now,
		refreshIfDue: options.refreshIfDue === true,
		stored:
			stored === undefined
				? undefined
				: {
						coreFetchedAt: stored.coreFetchedAt,
						volatileFetchedAt: stored.volatileFetchedAt,
					},
	});
	if (stored !== undefined && !plan.fetchCore && !plan.fetchVolatile) {
		return stored;
	}

	const need: SnapshotNeed = {
		fetchCore: plan.fetchCore,
		fetchVolatile: plan.fetchVolatile,
	};

	const load = async (): Promise<LoadedDocument> => {
		const snapshots = await fetchSnapshots(need, stored?.snapshots);
		const [head] = snapshots.volatile.segments;
		const freshnessClass = freshnessClassOf(
			{
				airedFrom: head?.airedFrom,
				airedTo: head?.airedTo,
				productionStatus: snapshots.core.productionStatus,
			},
			now,
		);
		return persist(
			store,
			provider,
			entryKey,
			version,
			now,
			snapshots,
			freshnessClass,
			need,
			options.force === true,
			stored,
			storedRow,
		);
	};

	if (
		stored !== undefined &&
		plan.serveStale &&
		options.schedule !== undefined
	) {
		const enqueue = async (): Promise<void> => {
			await load();
		};
		options.schedule(enqueue());
		return stored;
	}
	return load();
};

const lastUpdatedIso = (
	documents: readonly LoadedDocument[],
): string | undefined => {
	let latest: Date | undefined;
	for (const document of documents) {
		latest = laterDate(latest, document.coreFetchedAt);
		latest = laterDate(latest, document.volatileFetchedAt);
	}
	return latest?.toISOString();
};

const settleDocuments = async <Key>(
	jobs: readonly { key: Key; load: () => Promise<LoadedDocument> }[],
): Promise<Map<Key, LoadedDocument>> => {
	const settled = await Promise.allSettled(
		jobs.map(async (job) => {
			const document = await job.load();
			return { document, key: job.key };
		}),
	);
	const documents = new Map<Key, LoadedDocument>();
	let firstError: unknown;
	for (const result of settled) {
		if (result.status === "fulfilled") {
			documents.set(result.value.key, result.value.document);
			continue;
		}
		firstError ??= result.reason;
	}
	if (documents.size === 0 && firstError !== undefined) {
		if (firstError instanceof Error) {
			throw firstError;
		}
		throw new Error("catalogue metadata fetch failed");
	}
	return documents;
};

export { lastUpdatedIso, resolveCatalogueDocument, settleDocuments };
export type { LoadedDocument };
