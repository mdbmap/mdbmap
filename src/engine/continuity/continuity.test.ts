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
});
