import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
	continuities,
	continuitySegments,
	relationAssertions,
	serviceTitles,
	titleAssertions,
	titleGroups,
} from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import { createEngine } from "@/engine";
import { publishResearchProposals } from "@/engine/research";

import {
	continuityKey,
	groupContinuityKey,
	parseContinuityKey,
} from "./keys.ts";
import { ensureGroupContinuity, upsertRelationContinuity } from "./persist.ts";

const one = <Row>(rows: readonly Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected inserted row");
	}
	return row;
};

describe("continuity keys", () => {
	it("constructs and parses canonical and legacy keys", () => {
		expect(continuityKey(12)).toBe("continuity:12");
		expect(groupContinuityKey(7)).toBe("group:7");
		expect(parseContinuityKey("continuity:12")).toEqual({
			id: 12,
			type: "continuity",
		});
		expect(parseContinuityKey("group:7")).toEqual({ id: 7, type: "group" });
		expect(parseContinuityKey("continuity:nope")).toBeUndefined();
	});
});

describe("persisted continuity", () => {
	it("round-trips cross-group segments in relation order", async () => {
		const db = await freshDb();
		const seriesGroup = one(
			await db
				.insert(titleGroups)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		const filmGroup = one(
			await db
				.insert(titleGroups)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		const series = one(
			await db
				.insert(serviceTitles)
				.values({
					groupId: seriesGroup.id,
					service: "tmdb",
					serviceId: "tv:42",
				})
				.returning()
				.all(),
		);
		const film = one(
			await db
				.insert(serviceTitles)
				.values({
					groupId: filmGroup.id,
					service: "tmdb",
					serviceId: "movie:43",
				})
				.returning()
				.all(),
		);
		await publishResearchProposals(
			db,
			[
				{
					claim: "The film continues the series",
					evidence: [
						{
							kind: "api",
							official: true,
							operator: "TMDB",
							stance: "corroborates",
							url: "https://example.test/tmdb",
							validated: true,
						},
						{
							kind: "api",
							official: true,
							operator: "AniDB",
							stance: "corroborates",
							url: "https://example.test/anidb",
							validated: true,
						},
					],
					from: { service: series.service, serviceId: series.serviceId },
					kind: "relation",
					to: { service: film.service, serviceId: film.serviceId },
				},
			],
			async () => {
				/* empty */
			},
		);
		const continuity = one(await db.select().from(continuities).all());
		const resolved = await createEngine(db).resolveContinuity(
			`continuity:${continuity.id}`,
		);

		expect(resolved.segments.map((segment) => segment.kind)).toEqual([
			"episodic",
			"atomic",
		]);
		expect(resolved.segments.map((segment) => segment.members.tmdb)).toEqual([
			"42",
			"43",
		]);
		expect(await db.select().from(titleAssertions).all()).toHaveLength(0);
		expect(await db.select().from(relationAssertions).all()).toHaveLength(1);
		expect(await db.select().from(titleGroups).all()).toHaveLength(2);
		expect(await db.select().from(continuities).all()).toHaveLength(1);
		expect(await db.select().from(continuitySegments).all()).toHaveLength(2);
	});

	it("types a TMDB movie as atomic on the legacy group path", async () => {
		const db = await freshDb();
		const group = one(
			await db
				.insert(titleGroups)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		const film = one(
			await db
				.insert(serviceTitles)
				.values({
					groupId: group.id,
					service: "tmdb",
					serviceId: "movie:43",
				})
				.returning()
				.all(),
		);

		const continuityId = await ensureGroupContinuity(db, group.id);
		const segments = await db
			.select()
			.from(continuitySegments)
			.where(eq(continuitySegments.continuityId, continuityId))
			.all();

		expect(segments).toEqual([
			expect.objectContaining({
				kind: "atomic",
				titleId: film.id,
			}),
		]);
	});

	it("absorbs and retires a lazily ensured foreign continuity on join", async () => {
		const db = await freshDb();
		const seriesGroup = one(
			await db
				.insert(titleGroups)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		const filmGroup = one(
			await db
				.insert(titleGroups)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		const seasonOne = one(
			await db
				.insert(serviceTitles)
				.values({
					groupId: seriesGroup.id,
					ordinal: 0,
					service: "tmdb",
					serviceId: "tv:42",
				})
				.returning()
				.all(),
		);
		const seasonTwo = one(
			await db
				.insert(serviceTitles)
				.values({
					groupId: seriesGroup.id,
					ordinal: 1,
					service: "tmdb",
					serviceId: "tv:43",
				})
				.returning()
				.all(),
		);
		const film = one(
			await db
				.insert(serviceTitles)
				.values({
					groupId: filmGroup.id,
					service: "tmdb",
					serviceId: "movie:44",
				})
				.returning()
				.all(),
		);
		const seriesContinuity = await ensureGroupContinuity(db, seriesGroup.id);
		const filmContinuity = await ensureGroupContinuity(db, filmGroup.id);
		expect(filmContinuity).not.toBe(seriesContinuity);
		const assertion = one(
			await db
				.insert(relationAssertions)
				.values({
					confidence: "high",
					fromTitleId: seasonTwo.id,
					source: "t1-structure",
					toTitleId: film.id,
				})
				.returning()
				.all(),
		);

		const joined = await upsertRelationContinuity(db, {
			fromTitleId: seasonTwo.id,
			relationAssertionId: assertion.id,
			source: "t1-structure",
			toTitleId: film.id,
		});
		const remaining = await db.select().from(continuities).all();
		const segments = await db
			.select()
			.from(continuitySegments)
			.orderBy(asc(continuitySegments.releaseOrdinal))
			.all();

		expect(joined).toBe(seriesContinuity);
		expect(remaining.map((row) => row.id)).toEqual([seriesContinuity]);
		expect(segments.map((segment) => segment.titleId)).toEqual([
			seasonOne.id,
			seasonTwo.id,
			film.id,
		]);
		expect(segments.map((segment) => segment.kind)).toEqual([
			"episodic",
			"episodic",
			"atomic",
		]);
		expect(
			await createEngine(db).resolveContinuity(`group:${filmGroup.id}`),
		).toMatchObject({
			continuityId: `continuity:${seriesContinuity}`,
		});
	});

	it("prepends the series chain when the film continuity is older", async () => {
		const db = await freshDb();
		const seriesGroup = one(
			await db
				.insert(titleGroups)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		const filmGroup = one(
			await db
				.insert(titleGroups)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		const season = one(
			await db
				.insert(serviceTitles)
				.values({
					groupId: seriesGroup.id,
					service: "tmdb",
					serviceId: "tv:42",
				})
				.returning()
				.all(),
		);
		const film = one(
			await db
				.insert(serviceTitles)
				.values({
					groupId: filmGroup.id,
					service: "tmdb",
					serviceId: "movie:44",
				})
				.returning()
				.all(),
		);
		const filmContinuity = await ensureGroupContinuity(db, filmGroup.id);
		const seriesContinuity = await ensureGroupContinuity(db, seriesGroup.id);
		expect(filmContinuity).toBeLessThan(seriesContinuity);
		const assertion = one(
			await db
				.insert(relationAssertions)
				.values({
					confidence: "high",
					fromTitleId: season.id,
					source: "t1-structure",
					toTitleId: film.id,
				})
				.returning()
				.all(),
		);

		const joined = await upsertRelationContinuity(db, {
			fromTitleId: season.id,
			relationAssertionId: assertion.id,
			source: "t1-structure",
			toTitleId: film.id,
		});
		const remaining = await db.select().from(continuities).all();
		const segments = await db
			.select()
			.from(continuitySegments)
			.orderBy(asc(continuitySegments.releaseOrdinal))
			.all();

		expect(joined).toBe(filmContinuity);
		expect(remaining.map((row) => row.id)).toEqual([filmContinuity]);
		expect(segments.map((segment) => segment.titleId)).toEqual([
			season.id,
			film.id,
		]);
		expect(
			await createEngine(db).resolveContinuity(`group:${seriesGroup.id}`),
		).toMatchObject({
			continuityId: `continuity:${filmContinuity}`,
		});
	});
});
