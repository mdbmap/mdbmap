import { createRouterClient } from "@orpc/server";
import { describe, expect, it, vi } from "vitest";

import {
	continuities,
	continuitySegments,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import { user } from "@/db/schema";
import { freshDb } from "@/db/test-helpers";
import { continuityKey } from "@/engine/continuity/keys";
import { randomMasterKey } from "@/lib/provider-config/test-support.ts";
import { linkSyncAccount } from "@/lib/sync-accounts";
import type { ORPCContext } from "@/orpc/context";

import { router } from "./index.ts";

const one = <T>(rows: readonly T[]): T => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected row");
	}
	return row;
};

const seeded = async () => {
	const db = await freshDb();
	await db
		.insert(user)
		.values({ email: "a@b.test", id: "user-1", name: "Ada" })
		.run();
	return db;
};

const clientFor = (
	db: Awaited<ReturnType<typeof seeded>>,
	userId: string | undefined,
	masterKey?: string,
) =>
	createRouterClient(router, {
		context: {
			db,
			providerConfigMasterKey: masterKey ?? randomMasterKey(),
			resolveSession: () => (userId === undefined ? undefined : { id: userId }),
		} satisfies ORPCContext,
	});

describe("import.draftMal", () => {
	it("rejects unauthenticated callers", async () => {
		const db = await seeded();
		await expect(
			clientFor(db, undefined).import.draftMal({}),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("returns a draft without requiring sync entitlement", async () => {
		const db = await seeded();
		const masterKey = randomMasterKey();
		await linkSyncAccount(db, {
			credentials: { accessToken: "mal-token" },
			masterKeyBase64: masterKey,
			provider: "mal",
			userId: "user-1",
		});

		const group = one(
			await db
				.insert(titleGroups)
				.values({ ladderComplete: false, source: "t1-structure" })
				.returning()
				.all(),
		);
		const title = one(
			await db
				.insert(serviceTitles)
				.values({ groupId: group.id, service: "mal", serviceId: "7" })
				.returning()
				.all(),
		);
		const continuity = one(
			await db
				.insert(continuities)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		await db
			.insert(continuitySegments)
			.values({
				continuityId: continuity.id,
				kind: "episodic",
				releaseOrdinal: 0,
				titleId: title.id,
			})
			.run();

		const listPayload = {
			data: [
				{
					list_status: {
						num_episodes_watched: 1,
						score: 6,
						status: "watching",
					},
					node: { id: 7, title: "Seven" },
				},
			],
		};
		const fetchImpl = vi
			.spyOn(globalThis, "fetch")
			.mockResolvedValue(Response.json(listPayload));

		try {
			const draft = await clientFor(db, "user-1", masterKey).import.draftMal(
				{},
			);
			expect(draft.matched).toEqual([
				{
					continuityId: continuityKey(continuity.id),
					entry: {
						externalTitleId: "7",
						progress: 1,
						score: 6,
						status: "watching",
						title: "Seven",
						updatedAt: undefined,
					},
					proposedProgress: 1,
					proposedScore: 6,
					proposedStatus: "watching",
				},
			]);
			expect(draft.unmatched).toEqual([]);
			expect(draft.ambiguous).toEqual([]);
		} finally {
			fetchImpl.mockRestore();
		}
	});

	it("returns NOT_FOUND when MAL is not linked", async () => {
		const db = await seeded();
		await expect(
			clientFor(db, "user-1").import.draftMal({}),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});

describe("import.draftAnilist", () => {
	it("returns a draft without requiring sync entitlement", async () => {
		const db = await seeded();
		const masterKey = randomMasterKey();
		await linkSyncAccount(db, {
			credentials: { accessToken: "anilist-token" },
			masterKeyBase64: masterKey,
			provider: "anilist",
			userId: "user-1",
		});

		const group = one(
			await db
				.insert(titleGroups)
				.values({ ladderComplete: false, source: "t1-structure" })
				.returning()
				.all(),
		);
		const title = one(
			await db
				.insert(serviceTitles)
				.values({ groupId: group.id, service: "anilist", serviceId: "7" })
				.returning()
				.all(),
		);
		const continuity = one(
			await db
				.insert(continuities)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		await db
			.insert(continuitySegments)
			.values({
				continuityId: continuity.id,
				kind: "episodic",
				releaseOrdinal: 0,
				titleId: title.id,
			})
			.run();

		const fetchImpl = vi.spyOn(globalThis, "fetch");
		fetchImpl
			.mockResolvedValueOnce(Response.json({ data: { Viewer: { id: 1 } } }))
			.mockResolvedValueOnce(
				Response.json({
					data: {
						MediaListCollection: {
							lists: [
								{
									entries: [
										{
											media: { id: 7, title: { userPreferred: "Seven" } },
											progress: 1,
											score: 60,
											status: "CURRENT",
										},
									],
								},
							],
						},
					},
				}),
			);

		try {
			const draft = await clientFor(
				db,
				"user-1",
				masterKey,
			).import.draftAnilist({});
			expect(draft.provider).toBe("anilist");
			expect(draft.matched).toEqual([
				{
					continuityId: continuityKey(continuity.id),
					entry: {
						externalTitleId: "7",
						progress: 1,
						score: 6,
						status: "watching",
						title: "Seven",
						updatedAt: undefined,
					},
					proposedProgress: 1,
					proposedScore: 6,
					proposedStatus: "watching",
				},
			]);
			expect(draft.unmatched).toEqual([]);
			expect(draft.ambiguous).toEqual([]);
		} finally {
			fetchImpl.mockRestore();
		}
	});

	it("returns NOT_FOUND when AniList is not linked", async () => {
		const db = await seeded();
		await expect(
			clientFor(db, "user-1").import.draftAnilist({}),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});
});
