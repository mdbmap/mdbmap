import { and, eq, inArray } from "drizzle-orm";

import { serviceTitles } from "@/db/engine-schema";
import { continuityKey } from "@/engine/continuity/keys";
import { ensureGroupContinuity } from "@/engine/continuity/persist";
import type { Db } from "@/orpc/context";
import type { Similar } from "@/orpc/schema";

type SupportedSimilarRef =
	| { readonly service: "anidb"; readonly serviceId: string }
	| {
			readonly service: "tmdb";
			readonly serviceId: `${"movie" | "tv"}:${string}`;
	  };

const similarLookupKey = (ref: {
	readonly service: SupportedSimilarRef["service"];
	readonly serviceId: string;
}): string => `${ref.service}:${ref.serviceId}`;

const parseSimilarRef = (ref: string): SupportedSimilarRef | undefined => {
	const tmdb = /^tmdb:(?<type>tv|movie):(?<id>\d+)$/u.exec(ref);
	if (tmdb !== null) {
		const { id, type } = tmdb.groups ?? {};
		if (type !== "movie" && type !== "tv") {
			return undefined;
		}
		if (id === undefined) {
			return undefined;
		}
		return { service: "tmdb", serviceId: `${type}:${id}` };
	}
	const anidb = /^anidb:(?<id>\d+)$/u.exec(ref);
	const id = anidb?.groups?.["id"];
	if (id === undefined) {
		return undefined;
	}
	return { service: "anidb", serviceId: id };
};

const loadSimilarGroups = async (
	db: Db,
	refs: readonly (SupportedSimilarRef | undefined)[],
): Promise<ReadonlyMap<string, number>> => {
	const idsByService = new Map<SupportedSimilarRef["service"], string[]>();
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
				similarLookupKey({ service, serviceId: row.serviceId }),
				row.groupId,
			);
		}
	}
	return groups;
};

const resolveSimilar = async (
	db: Db,
	items: readonly Similar[],
): Promise<Similar[]> => {
	const refs = items.map((item) => parseSimilarRef(item.continuityId));
	const groups = await loadSimilarGroups(db, refs);
	const uniqueGroupIds = [
		...new Set(
			refs.flatMap((ref) => {
				if (ref === undefined) {
					return [];
				}
				const groupId = groups.get(similarLookupKey(ref));
				return groupId === undefined ? [] : [groupId];
			}),
		),
	];
	const continuityByGroup = new Map(
		await Promise.all(
			uniqueGroupIds.map(async (groupId) => {
				const id = continuityKey(await ensureGroupContinuity(db, groupId));
				return [groupId, id] as const;
			}),
		),
	);
	return items.map((item, index) => {
		const ref = refs[index];
		if (ref === undefined) {
			return item;
		}
		const groupId = groups.get(similarLookupKey(ref));
		if (groupId === undefined) {
			return item;
		}
		const resolvedId = continuityByGroup.get(groupId);
		if (resolvedId === undefined) {
			return item;
		}
		return { ...item, continuityId: resolvedId };
	});
};

export { resolveSimilar };
