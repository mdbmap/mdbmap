import { asc, eq, inArray } from "drizzle-orm";

import type { Db } from "@/db";
import {
	continuities,
	continuityAliases,
	continuitySegments,
	serviceTitles,
	titleGroupAliases,
	titleGroups,
} from "@/db/engine-schema";
import type { ContinuitySegmentKind, GroupSource } from "@/db/engine-schema";
import { one } from "@/db/one";
import { survivorGroupId } from "@/engine/gateway";

import { continuityKey, groupContinuityKey } from "./keys.ts";
import {
	afterSegmentRewrite,
	regenerateReleaseOrder,
	snapshotWatchOrder,
} from "./orders.ts";

type TitleRow = typeof serviceTitles.$inferSelect;

const takeFirst = <Row>(rows: readonly Row[]): Row | undefined => rows[0];

const survivorContinuityId = async (
	db: Db,
	continuityId: number,
): Promise<number> => {
	const aliases = await db
		.select({ survivorContinuityId: continuityAliases.survivorContinuityId })
		.from(continuityAliases)
		.where(eq(continuityAliases.retiredContinuityId, continuityId))
		.all();
	return takeFirst(aliases)?.survivorContinuityId ?? continuityId;
};

const retiredContinuityKeys = async (
	db: Db,
	survivorId: number,
): Promise<readonly `continuity:${number}`[]> => {
	const rows = await db
		.select({ retiredContinuityId: continuityAliases.retiredContinuityId })
		.from(continuityAliases)
		.where(eq(continuityAliases.survivorContinuityId, survivorId))
		.all();
	return rows.map((row) => continuityKey(row.retiredContinuityId));
};

const groupKeysForContinuity = async (
	db: Db,
	survivorId: number,
): Promise<readonly `group:${number}`[]> => {
	const rows = await db
		.select({ groupId: serviceTitles.groupId })
		.from(continuitySegments)
		.innerJoin(serviceTitles, eq(serviceTitles.id, continuitySegments.titleId))
		.where(eq(continuitySegments.continuityId, survivorId))
		.all();
	const groupIds = [...new Set(rows.map((row) => row.groupId))];
	if (groupIds.length === 0) {
		return [];
	}
	const retired = await db
		.select({ retiredGroupId: titleGroupAliases.retiredGroupId })
		.from(titleGroupAliases)
		.where(inArray(titleGroupAliases.survivorGroupId, groupIds))
		.all();
	return [
		...new Set([
			...groupIds.map((groupId) => groupContinuityKey(groupId)),
			...retired.map((row) => groupContinuityKey(row.retiredGroupId)),
		]),
	];
};

const trackingAliasKeys = async (
	db: Db,
	survivorId: number,
): Promise<readonly string[]> => [
	...new Set([
		...(await retiredContinuityKeys(db, survivorId)),
		...(await groupKeysForContinuity(db, survivorId)),
	]),
];

const retireContinuities = async (
	db: Db,
	input: {
		readonly foreignIds: readonly number[];
		readonly survivorId: number;
	},
): Promise<void> => {
	if (input.foreignIds.length === 0) {
		return;
	}
	await db
		.update(continuityAliases)
		.set({ survivorContinuityId: input.survivorId })
		.where(inArray(continuityAliases.survivorContinuityId, input.foreignIds))
		.run();
	await db
		.insert(continuityAliases)
		.values(
			input.foreignIds.map((retiredContinuityId) => ({
				retiredContinuityId,
				survivorContinuityId: input.survivorId,
			})),
		)
		.run();
	await db
		.delete(continuities)
		.where(inArray(continuities.id, input.foreignIds))
		.run();
};

const animeServices = new Set(["anidb", "anilist", "kitsu", "mal"]);

const isTmdbMovie = (title: TitleRow): boolean =>
	title.service === "tmdb" && title.serviceId.startsWith("movie:");

const kindForTitle = (
	title: TitleRow,
	groupTitles: readonly TitleRow[],
): ContinuitySegmentKind => {
	if (isTmdbMovie(title)) {
		return "atomic";
	}
	if (
		animeServices.has(title.service) &&
		groupTitles.some((member) => isTmdbMovie(member))
	) {
		return "atomic";
	}
	return "episodic";
};

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

interface SegmentDraft {
	readonly kind: ContinuitySegmentKind;
	readonly relationAssertionId?: number | null;
	readonly titleId: number;
}

const continuitiesForGroups = async (
	db: Db,
	groupIds: readonly number[],
): Promise<readonly number[]> => {
	if (groupIds.length === 0) {
		return [];
	}
	const rows = await db
		.select({ continuityId: continuitySegments.continuityId })
		.from(continuitySegments)
		.innerJoin(serviceTitles, eq(serviceTitles.id, continuitySegments.titleId))
		.where(inArray(serviceTitles.groupId, groupIds))
		.orderBy(asc(continuitySegments.continuityId))
		.all();
	return [...new Set(rows.map((row) => row.continuityId))];
};

const segmentsForContinuity = async (
	db: Db,
	continuityId: number,
): Promise<readonly SegmentDraft[]> =>
	db
		.select({
			kind: continuitySegments.kind,
			relationAssertionId: continuitySegments.relationAssertionId,
			titleId: continuitySegments.titleId,
		})
		.from(continuitySegments)
		.where(eq(continuitySegments.continuityId, continuityId))
		.orderBy(asc(continuitySegments.releaseOrdinal))
		.all();

const groupsForTitles = async (
	db: Db,
	titleIds: readonly number[],
): Promise<ReadonlySet<number>> => {
	if (titleIds.length === 0) {
		return new Set();
	}
	const rows = await db
		.select({ groupId: serviceTitles.groupId })
		.from(serviceTitles)
		.where(inArray(serviceTitles.id, titleIds))
		.all();
	return new Set(rows.map((row) => row.groupId));
};

const mergeForeignSegments = async (
	db: Db,
	input: {
		readonly foreignIds: readonly number[];
		readonly fromGroupId: number;
		readonly survivorSegments: readonly SegmentDraft[];
		readonly toGroupId: number;
	},
): Promise<readonly SegmentDraft[]> => {
	const representedTitleIds = new Set(
		input.survivorSegments.map((segment) => segment.titleId),
	);
	const foreignRows = await Promise.all(
		input.foreignIds.map(async (id) => segmentsForContinuity(db, id)),
	);
	const foreignSegments = foreignRows
		.flat()
		.filter((segment) => !representedTitleIds.has(segment.titleId));
	if (foreignSegments.length === 0) {
		return input.survivorSegments;
	}
	const survivorGroups = await groupsForTitles(
		db,
		input.survivorSegments.map((segment) => segment.titleId),
	);
	if (
		survivorGroups.has(input.toGroupId) &&
		!survivorGroups.has(input.fromGroupId)
	) {
		return [...foreignSegments, ...input.survivorSegments];
	}
	return [...input.survivorSegments, ...foreignSegments];
};

const rewriteSegments = async (
	db: Db,
	input: {
		readonly continuityId: number;
		readonly relationAssertionId?: number;
		readonly segments: readonly SegmentDraft[];
		readonly toTitleId?: number;
	},
): Promise<void> => {
	const watch = await snapshotWatchOrder(db, input.continuityId);
	await db
		.delete(continuitySegments)
		.where(eq(continuitySegments.continuityId, input.continuityId))
		.run();
	if (input.segments.length > 0) {
		await db
			.insert(continuitySegments)
			.values(
				input.segments.map((segment, releaseOrdinal) => ({
					continuityId: input.continuityId,
					kind: segment.kind,
					relationAssertionId:
						input.toTitleId !== undefined && segment.titleId === input.toTitleId
							? input.relationAssertionId
							: segment.relationAssertionId,
					releaseOrdinal,
					titleId: segment.titleId,
				})),
			)
			.run();
	}
	await afterSegmentRewrite(db, input.continuityId, watch);
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

const coalesceGroupContinuities = async (
	db: Db,
	existingIds: readonly number[],
	groupId: number,
): Promise<number> => {
	const [continuityId] = existingIds;
	if (continuityId === undefined) {
		throw new Error(`engine: no continuity group:${groupId}`);
	}
	const foreignIds = existingIds.filter((id) => id !== continuityId);
	if (foreignIds.length === 0) {
		return continuityId;
	}
	const survivorSegments = await segmentsForContinuity(db, continuityId);
	const merged = await mergeForeignSegments(db, {
		foreignIds,
		fromGroupId: groupId,
		survivorSegments,
		toGroupId: groupId,
	});
	await rewriteSegments(db, { continuityId, segments: merged });
	await retireContinuities(db, { foreignIds, survivorId: continuityId });
	return continuityId;
};

const ensureGroupContinuity = async (
	db: Db,
	requestedGroupId: number,
): Promise<number> => {
	const groupId = await survivorGroupId(db, requestedGroupId);
	const existingIds = await continuitiesForGroups(db, [groupId]);
	if (existingIds.length > 0) {
		return coalesceGroupContinuities(db, existingIds, groupId);
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
				kind: kindForTitle(title, titles),
				releaseOrdinal,
				titleId: title.id,
			})),
		)
		.run();
	await regenerateReleaseOrder(db, continuityId);
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
	const existingIds = await continuitiesForGroups(db, [
		from.groupId,
		to.groupId,
	]);
	const continuityId =
		existingIds[0] ?? (await createContinuity(db, input.source));
	const foreignIds = existingIds.filter((id) => id !== continuityId);
	const survivorSegments = await segmentsForContinuity(db, continuityId);
	const merged = await mergeForeignSegments(db, {
		foreignIds,
		fromGroupId: from.groupId,
		survivorSegments,
		toGroupId: to.groupId,
	});
	const representedGroups = await groupsForTitles(
		db,
		merged.map((segment) => segment.titleId),
	);
	const additions: TitleRow[] = [];
	if (!representedGroups.has(from.groupId)) {
		additions.push(from);
	}
	if (!representedGroups.has(to.groupId)) {
		additions.push(to);
	}
	if (additions.length === 0 && foreignIds.length === 0) {
		return continuityId;
	}
	const additionGroupIds = [
		...new Set(additions.map((title) => title.groupId)),
	];
	const additionGroupTitles =
		additionGroupIds.length === 0
			? []
			: await db
					.select()
					.from(serviceTitles)
					.where(inArray(serviceTitles.groupId, additionGroupIds))
					.all();
	const additionDrafts: SegmentDraft[] = additions.map((title) => ({
		kind: kindForTitle(
			title,
			additionGroupTitles.filter((row) => row.groupId === title.groupId),
		),
		titleId: title.id,
	}));
	const ordered =
		additionDrafts[0]?.titleId === from.id && representedGroups.has(to.groupId)
			? [...additionDrafts, ...merged]
			: [...merged, ...additionDrafts];
	await rewriteSegments(db, {
		continuityId,
		relationAssertionId: input.relationAssertionId,
		segments: ordered,
		toTitleId: input.toTitleId,
	});
	await retireContinuities(db, {
		foreignIds,
		survivorId: continuityId,
	});
	return continuityId;
};

export {
	ensureGroupContinuity,
	retiredContinuityKeys,
	survivorContinuityId,
	trackingAliasKeys,
	upsertRelationContinuity,
};
export type { RelationContinuityInput };
