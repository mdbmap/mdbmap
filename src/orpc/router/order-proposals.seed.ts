import { asc, eq } from "drizzle-orm";

import {
	continuities,
	continuitySegments,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import type { freshDb } from "@/db/test-helpers";
import { ensureGroupContinuity } from "@/engine/continuity/persist";

/** D1 caps bound parameters near 100; four binds per segment row → keep chunks ≤20. */
const SEGMENT_INSERT_CHUNK = 20;

type TestDb = Awaited<ReturnType<typeof freshDb>>;

const one = <Row>(rows: readonly Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected inserted row");
	}
	return row;
};

const insertSegmentChunks = async (
	db: TestDb,
	continuityId: number,
	titles: readonly { id: number }[],
): Promise<void> => {
	const chunks = Array.from(
		{ length: Math.ceil(titles.length / SEGMENT_INSERT_CHUNK) },
		(_ignored, index) => {
			const start = index * SEGMENT_INSERT_CHUNK;
			return titles
				.slice(start, start + SEGMENT_INSERT_CHUNK)
				.map((title, offset) => ({
					continuityId,
					kind: "episodic" as const,
					releaseOrdinal: start + offset,
					titleId: title.id,
				}));
		},
	);
	await Promise.all(
		chunks.map(async (chunk) =>
			db.insert(continuitySegments).values(chunk).run(),
		),
	);
};

const seedContinuity = async (db: TestDb, count: number) => {
	const group = one(
		await db
			.insert(titleGroups)
			.values({ source: "t1-structure" })
			.returning()
			.all(),
	);
	await Promise.all(
		Array.from({ length: count }, async (_ignored, ordinal) =>
			db
				.insert(serviceTitles)
				.values({
					groupId: group.id,
					ordinal,
					service: "tmdb",
					serviceId: `tv:${group.id}-${ordinal + 1}`,
				})
				.run(),
		),
	);
	if (count <= SEGMENT_INSERT_CHUNK) {
		const continuityId = await ensureGroupContinuity(db, group.id);
		const segments = await db
			.select({
				id: continuitySegments.id,
				titleId: continuitySegments.titleId,
			})
			.from(continuitySegments)
			.where(eq(continuitySegments.continuityId, continuityId))
			.orderBy(asc(continuitySegments.releaseOrdinal))
			.all();
		return { continuityId, segments };
	}
	const continuityId = one(
		await db
			.insert(continuities)
			.values({ source: group.source })
			.returning()
			.all(),
	).id;
	const titles = await db
		.select({ id: serviceTitles.id })
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, group.id))
		.orderBy(asc(serviceTitles.ordinal))
		.all();
	await insertSegmentChunks(db, continuityId, titles);
	const segments = await db
		.select({ id: continuitySegments.id, titleId: continuitySegments.titleId })
		.from(continuitySegments)
		.where(eq(continuitySegments.continuityId, continuityId))
		.orderBy(asc(continuitySegments.releaseOrdinal))
		.all();
	return { continuityId, segments };
};

export { seedContinuity };
