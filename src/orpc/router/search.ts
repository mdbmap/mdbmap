import { and, asc, eq, inArray } from "drizzle-orm";

import { continuitySegments, serviceTitles } from "@/db/engine-schema";
import { continuityKey } from "@/engine/continuity/keys";
import { pub } from "@/orpc/base";
import type { Db } from "@/orpc/context";
import type { CatalogueSearchHit } from "@/orpc/providers";
import type { CatalogueTitle, SearchHit } from "@/orpc/schema";
import { SearchQueryInput } from "@/orpc/schema";

type SearchCatalogueRef =
	| { readonly service: "anilist"; readonly serviceId: string }
	| {
			readonly service: "tmdb";
			readonly serviceId: `${"movie" | "tv"}:${string}`;
	  };

const catalogueLookupKey = (ref: {
	readonly service: string;
	readonly serviceId: string;
}): string => `${ref.service}:${ref.serviceId}`;

const catalogueRefOf = (
	catalogue: CatalogueTitle,
): SearchCatalogueRef | undefined => {
	if (catalogue.service === "tmdb") {
		return {
			service: "tmdb",
			serviceId: `${catalogue.namespace}:${catalogue.id}`,
		};
	}
	if (catalogue.service === "anilist") {
		return { service: "anilist", serviceId: catalogue.id };
	}
	return undefined;
};

const loadMappedGroups = async (
	db: Db,
	refs: readonly (SearchCatalogueRef | undefined)[],
): Promise<ReadonlyMap<string, number>> => {
	const idsByService = new Map<SearchCatalogueRef["service"], string[]>();
	for (const ref of refs) {
		if (ref === undefined) {
			continue;
		}
		const ids = idsByService.get(ref.service) ?? [];
		ids.push(ref.serviceId);
		idsByService.set(ref.service, ids);
	}
	const loaded = await Promise.all(
		[...idsByService.entries()].map(async ([service, serviceIds]) => {
			const uniqueIds = [...new Set(serviceIds)];
			const rows = await db
				.select({
					groupId: serviceTitles.groupId,
					serviceId: serviceTitles.serviceId,
				})
				.from(serviceTitles)
				.where(
					and(
						eq(serviceTitles.service, service),
						inArray(serviceTitles.serviceId, uniqueIds),
					),
				)
				.all();
			return { rows, service };
		}),
	);
	const groups = new Map<string, number>();
	for (const { rows, service } of loaded) {
		for (const row of rows) {
			groups.set(
				catalogueLookupKey({ service, serviceId: row.serviceId }),
				row.groupId,
			);
		}
	}
	return groups;
};

const loadKnownContinuities = async (
	db: Db,
	groupIds: readonly number[],
): Promise<ReadonlyMap<number, string>> => {
	if (groupIds.length === 0) {
		return new Map();
	}
	const rows = await db
		.select({
			continuityId: continuitySegments.continuityId,
			groupId: serviceTitles.groupId,
		})
		.from(continuitySegments)
		.innerJoin(serviceTitles, eq(serviceTitles.id, continuitySegments.titleId))
		.where(inArray(serviceTitles.groupId, groupIds))
		.orderBy(asc(continuitySegments.continuityId))
		.all();
	const continuityByGroup = new Map<number, string>();
	for (const row of rows) {
		if (!continuityByGroup.has(row.groupId)) {
			continuityByGroup.set(row.groupId, continuityKey(row.continuityId));
		}
	}
	return continuityByGroup;
};

const attachContinuity = async (
	db: Db,
	hits: readonly CatalogueSearchHit[],
): Promise<SearchHit[]> => {
	const refs = hits.map((hit) => catalogueRefOf(hit.catalogue));
	const groups = await loadMappedGroups(db, refs);
	const uniqueGroupIds = [
		...new Set(
			refs.flatMap((ref) => {
				if (ref === undefined) {
					return [];
				}
				const groupId = groups.get(catalogueLookupKey(ref));
				return groupId === undefined ? [] : [groupId];
			}),
		),
	];
	const continuityByGroup = await loadKnownContinuities(db, uniqueGroupIds);
	return hits.map((hit, index) => {
		const ref = refs[index];
		const groupId =
			ref === undefined ? undefined : groups.get(catalogueLookupKey(ref));
		const continuityId =
			groupId === undefined ? undefined : continuityByGroup.get(groupId);
		return {
			catalogue: hit.catalogue,
			continuityId,
			coverRef: hit.coverRef,
			mediaKind: hit.mediaKind,
			title: hit.title,
			year: hit.year,
		};
	});
};

const query = pub
	.input(SearchQueryInput)
	.handler(async ({ context, input }): Promise<SearchHit[]> => {
		const trimmed = input.query.trim();
		if (trimmed.length === 0) {
			return [];
		}
		const hits = await context.providers.catalogueSearch.search(
			trimmed,
			input.mediaKind === undefined
				? undefined
				: { mediaKind: input.mediaKind },
		);
		return attachContinuity(context.db, hits);
	});

const search = { query };

export { search };
