import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
	episodeProgress,
	personalRating,
	user,
	watchStatus,
} from "@/db/schema";
import { freshDb } from "@/db/test-helpers";
import type { EngineRead } from "@/engine";

import { applyImportDraft, withFingerprint } from "./apply-draft.ts";
import type { ImportDraft, ImportMatchedRow } from "./types.ts";

const continuityId = "continuity:1";

const stubEngine = (locators: readonly string[]): EngineRead => ({
	resolveContinuity: async () => {
		await Promise.resolve();
		return {
			continuityId,
			mediaKind: "anime",
			segments: [
				{
					instalments: locators,
					kind: "episodic",
					members: { mal: "1" },
				},
			],
		};
	},
});

const matched = (
	overrides: Partial<ImportMatchedRow> = {},
): ImportMatchedRow => ({
	continuityId,
	entry: {
		externalTitleId: "1",
		progress: 2,
		score: 8,
		status: "watching",
		title: "One",
		updatedAt: "2020-01-01T00:00:00.000Z",
	},
	proposedProgress: 2,
	proposedScore: 8,
	proposedStatus: "watching",
	...overrides,
});

const draftOf = (
	matchedRows: readonly ImportMatchedRow[],
	extra: Partial<Omit<ImportDraft, "fingerprint">> = {},
): ImportDraft =>
	withFingerprint({
		ambiguous: [],
		matched: matchedRows,
		provider: "mal",
		unmatched: [],
		...extra,
	});

const apply = async (
	db: Awaited<ReturnType<typeof freshDb>>,
	draft: ImportDraft,
	engine: EngineRead,
	extra: {
		overwriteLocal?: boolean;
		resolutions?: readonly { continuityId: string; externalTitleId: string }[];
	} = {},
) =>
	applyImportDraft({
		db,
		draft,
		engine,
		fingerprint: draft.fingerprint,
		userId: "user-1",
		...(extra.overwriteLocal === undefined
			? {}
			: { overwriteLocal: extra.overwriteLocal }),
		...(extra.resolutions === undefined
			? {}
			: { resolutions: extra.resolutions }),
	});

describe("applyImportDraft", () => {
	it("writes status, score, and progress for matched rows", async () => {
		const db = await freshDb();
		await db
			.insert(user)
			.values({ email: "a@b.test", id: "user-1", name: "Ada" })
			.run();
		const draft = draftOf([matched()]);

		const result = await apply(
			db,
			draft,
			stubEngine(["mal:1#1", "mal:1#2", "mal:1#3"]),
		);

		expect(result).toEqual({
			applied: 1,
			provider: "mal",
			skippedNewerLocal: 0,
			skippedUnmatched: 0,
			skippedUnresolved: 0,
		});
		expect(await db.select().from(watchStatus).all()).toMatchObject([
			{ continuityKey: continuityId, status: "watching" },
		]);
		expect(await db.select().from(personalRating).all()).toMatchObject([
			{ score: 8, unitKey: continuityId, unitKind: "work" },
		]);
		const progressRows = await db.select().from(episodeProgress).all();
		expect(progressRows.map((row) => row.instalmentLocator)).toEqual([
			"mal:1#1",
			"mal:1#2",
		]);
	});

	it("skips newer local rows unless overwriteLocal is set", async () => {
		const db = await freshDb();
		await db
			.insert(user)
			.values({ email: "a@b.test", id: "user-1", name: "Ada" })
			.run();
		await db
			.insert(watchStatus)
			.values({
				continuityKey: continuityId,
				status: "completed",
				userId: "user-1",
			})
			.run();
		await db
			.update(watchStatus)
			.set({ updatedAt: new Date("2025-01-01T00:00:00.000Z") })
			.where(
				and(
					eq(watchStatus.userId, "user-1"),
					eq(watchStatus.continuityKey, continuityId),
				),
			)
			.run();

		const draft = draftOf([
			matched({
				proposedProgress: undefined,
				proposedScore: undefined,
			}),
		]);
		const result = await apply(db, draft, stubEngine([]));
		expect(result.skippedNewerLocal).toBe(1);
		expect(result.applied).toBe(0);
		expect(await db.select().from(watchStatus).all()).toMatchObject([
			{ status: "completed" },
		]);

		const forced = await apply(db, draft, stubEngine([]), {
			overwriteLocal: true,
		});
		expect(forced.applied).toBe(1);
		expect(await db.select().from(watchStatus).all()).toMatchObject([
			{ status: "watching" },
		]);
	});

	it("is idempotent on re-apply", async () => {
		const db = await freshDb();
		await db
			.insert(user)
			.values({ email: "a@b.test", id: "user-1", name: "Ada" })
			.run();
		const draft = draftOf([matched({ proposedProgress: 1 })]);
		const engine = stubEngine(["mal:1#1"]);
		const first = await apply(db, draft, engine);
		expect(first.applied).toBe(1);
		const second = await apply(db, draft, engine);
		expect(second.applied).toBe(0);
	});

	it("applies resolved ambiguous rows and counts unresolved skips", async () => {
		const db = await freshDb();
		await db
			.insert(user)
			.values({ email: "a@b.test", id: "user-1", name: "Ada" })
			.run();
		const draft = draftOf([], {
			ambiguous: [
				{
					continuityIds: [continuityId, "continuity:2"],
					entry: {
						externalTitleId: "9",
						progress: undefined,
						score: 7,
						status: "completed",
						title: "Ambiguous",
						updatedAt: undefined,
					},
				},
				{
					continuityIds: ["continuity:3", "continuity:4"],
					entry: {
						externalTitleId: "10",
						progress: undefined,
						score: undefined,
						status: "watching",
						title: "Unresolved",
						updatedAt: undefined,
					},
				},
			],
			unmatched: [
				{
					entry: {
						externalTitleId: "11",
						progress: undefined,
						score: undefined,
						status: "watching",
						title: "Missing",
						updatedAt: undefined,
					},
					reason: "no_service_title",
				},
			],
		});
		const result = await apply(db, draft, stubEngine([]), {
			resolutions: [{ continuityId, externalTitleId: "9" }],
		});
		expect(result).toMatchObject({
			applied: 1,
			skippedUnmatched: 1,
			skippedUnresolved: 1,
		});
		expect(await db.select().from(watchStatus).all()).toMatchObject([
			{ continuityKey: continuityId, status: "completed" },
		]);
	});

	it("applies a matched plan_to_watch row", async () => {
		const db = await freshDb();
		await db
			.insert(user)
			.values({ email: "a@b.test", id: "user-1", name: "Ada" })
			.run();
		const draft = draftOf([
			matched({
				entry: {
					externalTitleId: "1",
					progress: 0,
					score: 0,
					status: "plan_to_watch",
					title: "Queued",
					updatedAt: undefined,
				},
				proposedProgress: 0,
				proposedScore: undefined,
				proposedStatus: "plan_to_watch",
			}),
		]);

		const result = await apply(db, draft, stubEngine(["mal:1#1"]));

		expect(result).toEqual({
			applied: 1,
			provider: "mal",
			skippedNewerLocal: 0,
			skippedUnmatched: 0,
			skippedUnresolved: 0,
		});
		expect(await db.select().from(watchStatus).all()).toMatchObject([
			{ continuityKey: continuityId, status: "plan_to_watch" },
		]);
		expect(await db.select().from(episodeProgress).all()).toEqual([]);
	});

	it("rejects a stale fingerprint", async () => {
		const db = await freshDb();
		await db
			.insert(user)
			.values({ email: "a@b.test", id: "user-1", name: "Ada" })
			.run();
		const draft = draftOf([matched()]);
		await expect(
			applyImportDraft({
				db,
				draft,
				engine: stubEngine([]),
				fingerprint: "deadbeef",
				userId: "user-1",
			}),
		).rejects.toThrow(/fingerprint mismatch/u);
	});
});
