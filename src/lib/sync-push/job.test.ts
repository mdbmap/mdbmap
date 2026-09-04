/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { describe, expect, it } from "vitest";

import { user, watchStatus } from "@/db/schema";
import { freshDb } from "@/db/test-helpers.ts";
import { randomMasterKey } from "@/lib/provider-config/test-support.ts";
import { linkSyncAccount, listSyncAccounts } from "@/lib/sync-accounts";

import { createStubTargetClient } from "./clients/stub.ts";
import { pushContinuity } from "./job.ts";

const seedUser = async (db: Awaited<ReturnType<typeof freshDb>>) => {
	await db
		.insert(user)
		.values({ email: "a@b.test", id: "user-1", name: "Ada" })
		.run();
};

const linkBothTargets = async (
	db: Awaited<ReturnType<typeof freshDb>>,
	masterKey: string,
) => {
	await linkSyncAccount(db, {
		credentials: { accessToken: "tok" },
		externalAccountId: "a",
		masterKeyBase64: masterKey,
		provider: "anilist",
		userId: "user-1",
	});
	await linkSyncAccount(db, {
		credentials: { accessToken: "tok" },
		externalAccountId: "m",
		masterKeyBase64: masterKey,
		provider: "mal",
		userId: "user-1",
	});
};

describe("pushContinuity", () => {
	it("isolates per-target failures without aborting siblings", async () => {
		const db = await freshDb();
		await seedUser(db);
		const masterKey = randomMasterKey();
		await linkBothTargets(db, masterKey);
		await db
			.insert(watchStatus)
			.values({
				continuityKey: "continuity:1",
				status: "completed",
				userId: "user-1",
			})
			.run();

		const anilist = createStubTargetClient("anilist");
		const mal = createStubTargetClient("mal", () => {
			throw new Error("mal down");
		});

		const result = await pushContinuity({
			continuityId: "continuity:1",
			createClient: (provider) => (provider === "anilist" ? anilist : mal),
			db,
			engine: {
				resolveContinuity: async () => {
					await Promise.resolve();
					return {
						continuityId: "continuity:1",
						mediaKind: "anime",
						segments: [
							{
								instalments: ["anidb:1#1"],
								kind: "episodic",
								members: { anilist: "10", mal: "20" },
							},
						],
					};
				},
			},
			masterKeyBase64: masterKey,
			userId: "user-1",
		});

		expect(result.targets).toEqual([
			expect.objectContaining({ ok: true, provider: "anilist" }),
			expect.objectContaining({
				error: "mal down",
				ok: false,
				provider: "mal",
			}),
		]);
		expect(anilist.batches).toHaveLength(1);

		const listed = await listSyncAccounts(db, "user-1");
		const anilistRow = listed.find((row) => row.provider === "anilist");
		const malRow = listed.find((row) => row.provider === "mal");
		expect(anilistRow?.cursor).toEqual(
			expect.stringContaining("continuity:1@"),
		);
		expect(anilistRow?.lastError).toBeNull();
		expect(malRow?.lastError).toBe("mal down");
	});
});
