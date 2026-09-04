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

import { buildAnilistImportDraft, buildMalImportDraft } from "./build-draft.ts";

const one = <T>(rows: readonly T[]): T => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected row");
	}
	return row;
};

const hrefOf = (request: RequestInfo | URL | undefined): string | undefined => {
	if (typeof request === "string") {
		return request;
	}
	if (request instanceof URL) {
		return request.href;
	}
	if (request instanceof Request) {
		return request.url;
	}
	return undefined;
};

describe("buildMalImportDraft", () => {
	it("loads the linked MAL token, fetches the list, and matches", async () => {
		const db = await freshDb();
		const masterKey = randomMasterKey();
		await db
			.insert(user)
			.values({ email: "a@b.test", id: "user-1", name: "Ada" })
			.run();
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
				.values({ groupId: group.id, service: "mal", serviceId: "42" })
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
						num_episodes_watched: 2,
						score: 8,
						status: "watching",
					},
					node: { id: 42, title: "Matched" },
				},
				{
					list_status: {
						num_episodes_watched: 0,
						score: 0,
						status: "plan_to_watch",
					},
					node: { id: 99, title: "Unknown" },
				},
			],
		};
		const fetchImpl: typeof fetch = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json(listPayload));

		const draft = await buildMalImportDraft({
			db,
			fetchImpl,
			masterKeyBase64: masterKey,
			userId: "user-1",
		});

		const [requestUrl, requestInit] = vi.mocked(fetchImpl).mock.calls[0] ?? [];
		expect(hrefOf(requestUrl)).toContain("/users/@me/animelist");
		expect(requestInit).toMatchObject({
			headers: { Authorization: "Bearer mal-token" },
		});
		expect(draft.matched).toEqual([
			{
				continuityId: continuityKey(continuity.id),
				entry: {
					externalTitleId: "42",
					progress: 2,
					score: 8,
					status: "watching",
					title: "Matched",
					updatedAt: undefined,
				},
				proposedProgress: 2,
				proposedScore: 8,
				proposedStatus: "watching",
			},
		]);
		expect(draft.unmatched).toEqual([
			{
				entry: {
					externalTitleId: "99",
					progress: 0,
					score: 0,
					status: "plan_to_watch",
					title: "Unknown",
					updatedAt: undefined,
				},
				reason: "no_service_title",
			},
		]);
	});

	it("requires a linked MAL account", async () => {
		const db = await freshDb();
		await db
			.insert(user)
			.values({ email: "a@b.test", id: "user-1", name: "Ada" })
			.run();
		await expect(
			buildMalImportDraft({
				db,
				masterKeyBase64: randomMasterKey(),
				userId: "user-1",
			}),
		).rejects.toMatchObject({ name: "MalAccountNotLinkedError" });
	});
});

describe("buildAnilistImportDraft", () => {
	it("loads the linked AniList token, fetches the list, and matches", async () => {
		const db = await freshDb();
		const masterKey = randomMasterKey();
		await db
			.insert(user)
			.values({ email: "a@b.test", id: "user-1", name: "Ada" })
			.run();
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
				.values({ groupId: group.id, service: "anilist", serviceId: "55" })
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

		const fetchImpl: typeof fetch = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json({ data: { Viewer: { id: 1 } } }))
			.mockResolvedValueOnce(
				Response.json({
					data: {
						MediaListCollection: {
							lists: [
								{
									entries: [
										{
											media: { id: 55, title: { userPreferred: "Matched" } },
											progress: 2,
											score: 90,
											status: "CURRENT",
										},
										{
											media: { id: 99, title: { userPreferred: "Unknown" } },
											progress: 0,
											score: 0,
											status: "PLANNING",
										},
									],
								},
							],
						},
					},
				}),
			);

		const draft = await buildAnilistImportDraft({
			db,
			fetchImpl,
			masterKeyBase64: masterKey,
			userId: "user-1",
		});

		expect(draft.provider).toBe("anilist");
		expect(draft.matched).toEqual([
			{
				continuityId: continuityKey(continuity.id),
				entry: {
					externalTitleId: "55",
					progress: 2,
					score: 9,
					status: "watching",
					title: "Matched",
					updatedAt: undefined,
				},
				proposedProgress: 2,
				proposedScore: 9,
				proposedStatus: "watching",
			},
		]);
		expect(draft.unmatched).toEqual([
			{
				entry: {
					externalTitleId: "99",
					progress: 0,
					score: undefined,
					status: "plan_to_watch",
					title: "Unknown",
					updatedAt: undefined,
				},
				reason: "no_service_title",
			},
		]);
	});

	it("requires a linked AniList account", async () => {
		const db = await freshDb();
		await db
			.insert(user)
			.values({ email: "a@b.test", id: "user-1", name: "Ada" })
			.run();
		await expect(
			buildAnilistImportDraft({
				db,
				masterKeyBase64: randomMasterKey(),
				userId: "user-1",
			}),
		).rejects.toMatchObject({ name: "AnilistAccountNotLinkedError" });
	});
});
