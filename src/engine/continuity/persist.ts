import { asc, eq, inArray } from "drizzle-orm";

import type { Db } from "@/db";
import {
	continuities,
	continuitySegments,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import type { ContinuitySegmentKind, GroupSource } from "@/db/engine-schema";
import { one } from "@/db/one";
import { survivorGroupId } from "@/engine/gateway";

type TitleRow = typeof serviceTitles.$inferSelect;

const animeServices = new Set(["anidb", "anilist", "kitsu", "mal"]);

const kindForTitle = (title: TitleRow): ContinuitySegmentKind =>
	title.service === "tmdb" && title.serviceId.startsWith("movie:")
		? "atomic"
		: "episodic";

const spineTitles = (titles: readonly TitleRow[]): readonly TitleRow[] => {
	const provider = titles.some((title) => animeServices.has(title.service))
		? "anidb"
		: "tmdb";
	return titles
		.filter((title) => title.service === provider)
		.toSorted(
			(left, right) => left.ordinal - right.ordinal || left.id - right.id,
		);
};

const continuityForGroups = async (
	db: Db,
	groupIds: readonly number[],
): Promise<number | undefined> => {
	if (groupIds.length === 0) {
		return undefined;
	}
	const rows = await db
		.select({ continuityId: continuitySegments.continuityId })
		.from(continuitySegments)
		.innerJoin(serviceTitles, eq(serviceTitles.id, continuitySegments.titleId))
		.where(inArray(serviceTitles.groupId, groupIds))
		.orderBy(asc(continuitySegments.continuityId))
		.all();
	return rows[0]?.continuityId;
};

const createContinuity = async (
	db: Db,
	source: GroupSource,
): Promise<number> => {
	const rows = await db
		.insert(continuities)
		.values({ source })
		.returning()
		.all();
	return one(rows).id;
};

const ensureGroupContinuity = async (
	db: Db,
	requestedGroupId: number,
): Promise<number> => {
	const groupId = await survivorGroupId(db, requestedGroupId);
	const existing = await continuityForGroups(db, [groupId]);
	if (existing !== undefined) {
		return existing;
	}
	const group = await db
		.select()
		.from(titleGroups)
		.where(eq(titleGroups.id, groupId))
		.get();
	if (group === undefined) {
		throw new Error(`engine: no continuity group:${requestedGroupId}`);
	}
	const titles = await db
		.select()
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, groupId))
		.all();
	const spine = spineTitles(titles);
	if (spine.length === 0) {
		throw new Error(
			`engine: continuity group:${requestedGroupId} has no metadata spine`,
		);
	}
	const continuityId = await createContinuity(db, group.source);
	await db
		.insert(continuitySegments)
		.values(
			spine.map((title, releaseOrdinal) => ({
				continuityId,
				kind: "episodic" as const,
				releaseOrdinal,
				titleId: title.id,
			})),
		)
		.run();
	return continuityId;
};

interface RelationContinuityInput {
	readonly fromTitleId: number;
	readonly relationAssertionId: number;
	readonly source: GroupSource;
	readonly toTitleId: number;
}

const upsertRelationContinuity = async (
	db: Db,
	input: RelationContinuityInput,
): Promise<number | undefined> => {
	const endpoints = await db
		.select()
		.from(serviceTitles)
		.where(inArray(serviceTitles.id, [input.fromTitleId, input.toTitleId]))
		.all();
	const from = endpoints.find((title) => title.id === input.fromTitleId);
	const to = endpoints.find((title) => title.id === input.toTitleId);
	if (from === undefined || to === undefined || from.groupId === to.groupId) {
		return undefined;
	}
	const existingId = await continuityForGroups(db, [from.groupId, to.groupId]);
	const continuityId = existingId ?? (await createContinuity(db, input.source));
	const existingSegments = await db
		.select({
			kind: continuitySegments.kind,
			relationAssertionId: continuitySegments.relationAssertionId,
			releaseOrdinal: continuitySegments.releaseOrdinal,
			titleId: continuitySegments.titleId,
		})
		.from(continuitySegments)
		.where(eq(continuitySegments.continuityId, continuityId))
		.orderBy(asc(continuitySegments.releaseOrdinal))
		.all();
	const represented = await db
		.select({ groupId: serviceTitles.groupId })
		.from(continuitySegments)
		.innerJoin(serviceTitles, eq(serviceTitles.id, continuitySegments.titleId))
		.where(eq(continuitySegments.continuityId, continuityId))
		.all();
	const representedGroups = new Set(represented.map((row) => row.groupId));
	const additions: TitleRow[] = [];
	if (!representedGroups.has(from.groupId)) {
		additions.push(from);
	}
	if (!representedGroups.has(to.groupId)) {
		additions.push(to);
	}
	if (additions.length === 0) {
		return continuityId;
	}
	const ordered =
		additions[0]?.id === from.id && representedGroups.has(to.groupId)
			? [
					...additions.map((title) => ({
						kind: kindForTitle(title),
						relationAssertionId: undefined,
						titleId: title.id,
					})),
					...existingSegments,
				]
			: [
					...existingSegments,
					...additions.map((title) => ({
						kind: kindForTitle(title),
						relationAssertionId: undefined,
						titleId: title.id,
					})),
				];
	await db
		.delete(continuitySegments)
		.where(eq(continuitySegments.continuityId, continuityId))
		.run();
	await db
		.insert(continuitySegments)
		.values(
			ordered.map((segment, releaseOrdinal) => ({
				continuityId,
				kind: segment.kind,
				relationAssertionId:
					segment.titleId === input.toTitleId
						? input.relationAssertionId
						: segment.relationAssertionId,
				releaseOrdinal,
				titleId: segment.titleId,
			})),
		)
		.run();
	return continuityId;
};

export {
	ensureGroupContinuity,
	kindForTitle,
	spineTitles,
	upsertRelationContinuity,
};
export type { RelationContinuityInput };
