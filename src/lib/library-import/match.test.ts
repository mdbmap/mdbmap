import { describe, expect, it } from "vitest";

import {
	continuities,
	continuityAliases,
	continuitySegments,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import { continuityKey } from "@/engine/continuity/keys";

import { matchMalEntries } from "./match.ts";
import type { ImportListEntry } from "./types.ts";

const one = <T>(rows: readonly T[]): T => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected row");
	}
	return row;
};

const entry = (
	externalTitleId: string,
	overrides: Partial<ImportListEntry> = {},
): ImportListEntry => ({
	externalTitleId,
	progress: 4,
	score: 9,
	status: "watching",
	title: `MAL ${externalTitleId}`,
	updatedAt: undefined,
	...overrides,
});

describe("matchMalEntries", () => {
	it("classifies matched, ambiguous, unmatched, and alias survivors", async () => {
		const db = await freshDb();

		const group = one(
			await db
				.insert(titleGroups)
				.values({ ladderComplete: false, source: "t1-structure" })
				.returning()
				.all(),
		);

		const matchedTitle = one(
			await db
				.insert(serviceTitles)
				.values({ groupId: group.id, service: "mal", serviceId: "101" })
				.returning()
				.all(),
		);
		const noContinuityTitle = one(
			await db
				.insert(serviceTitles)
				.values({ groupId: group.id, service: "mal", serviceId: "102" })
				.returning()
				.all(),
		);
		const ambiguousTitle = one(
			await db
				.insert(serviceTitles)
				.values({ groupId: group.id, service: "mal", serviceId: "103" })
				.returning()
				.all(),
		);
		const retiredTitle = one(
			await db
				.insert(serviceTitles)
				.values({ groupId: group.id, service: "mal", serviceId: "104" })
				.returning()
				.all(),
		);

		const continuityA = one(
			await db
				.insert(continuities)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		const continuityB = one(
			await db
				.insert(continuities)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		const continuityRetired = one(
			await db
				.insert(continuities)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		const continuitySurvivor = one(
			await db
				.insert(continuities)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);

		await db
			.insert(continuitySegments)
			.values([
				{
					continuityId: continuityA.id,
					kind: "episodic",
					releaseOrdinal: 0,
					titleId: matchedTitle.id,
				},
				{
					continuityId: continuityA.id,
					kind: "episodic",
					releaseOrdinal: 1,
					titleId: ambiguousTitle.id,
				},
				{
					continuityId: continuityB.id,
					kind: "episodic",
					releaseOrdinal: 0,
					titleId: ambiguousTitle.id,
				},
				{
					continuityId: continuityRetired.id,
					kind: "episodic",
					releaseOrdinal: 0,
					titleId: retiredTitle.id,
				},
			])
			.run();

		await db
			.insert(continuityAliases)
			.values({
				retiredContinuityId: continuityRetired.id,
				survivorContinuityId: continuitySurvivor.id,
			})
			.run();

		const draft = await matchMalEntries(db, [
			entry("101"),
			entry("102"),
			entry("103"),
			entry("104", { score: 0, status: "plan_to_watch" }),
			entry("999"),
			entry("101", { progress: 1, score: 5, status: "on_hold" }),
		]);

		expect(draft.provider).toBe("mal");
		expect(draft.matched).toEqual([
			{
				continuityId: continuityKey(continuityA.id),
				entry: entry("101"),
				proposedProgress: 4,
				proposedScore: 9,
				proposedStatus: "watching",
			},
			{
				continuityId: continuityKey(continuitySurvivor.id),
				entry: entry("104", { score: 0, status: "plan_to_watch" }),
				proposedProgress: 4,
				proposedScore: undefined,
				proposedStatus: undefined,
			},
			{
				continuityId: continuityKey(continuityA.id),
				entry: entry("101", { progress: 1, score: 5, status: "on_hold" }),
				proposedProgress: 1,
				proposedScore: 5,
				proposedStatus: "on_hold",
			},
		]);
		expect(draft.ambiguous).toEqual([
			{
				continuityIds: [
					continuityKey(continuityA.id),
					continuityKey(continuityB.id),
				],
				entry: entry("103"),
			},
		]);
		expect(draft.unmatched).toEqual([
			{ entry: entry("102"), reason: "no_continuity" },
			{ entry: entry("999"), reason: "no_service_title" },
		]);
		expect(noContinuityTitle.serviceId).toBe("102");
	});
});
