/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { syncAccountLink, user } from "@/db/schema";
import { freshDb } from "@/db/test-helpers.ts";
import { randomMasterKey } from "@/lib/provider-config/test-support.ts";

import {
	linkSyncAccount,
	listSyncAccounts,
	readSyncAccountCredentials,
	unlinkSyncAccount,
} from "./store.ts";

const seedUser = async (db: Awaited<ReturnType<typeof freshDb>>) => {
	await db
		.insert(user)
		.values({ email: "a@b.test", id: "user-1", name: "Ada" })
		.run();
};

describe("sync account store link", () => {
	let db: Awaited<ReturnType<typeof freshDb>>;
	let masterKey: string;

	beforeEach(async () => {
		db = await freshDb();
		masterKey = randomMasterKey();
		await seedUser(db);
	});

	it("round-trips credentials under the envelope", async () => {
		const linked = await linkSyncAccount(db, {
			credentials: {
				accessToken: "tok-secret",
				refreshToken: "ref-secret",
			},
			externalAccountId: "ext-1",
			masterKeyBase64: masterKey,
			provider: "anilist",
			userId: "user-1",
		});

		expect(linked).toMatchObject({
			externalAccountId: "ext-1",
			provider: "anilist",
		});
		expect(linked.cursor).toBeNull();
		expect(linked.lastError).toBeNull();
		expect(linked.linkedAt).toBeInstanceOf(Date);

		await expect(
			readSyncAccountCredentials(db, masterKey, "user-1", "anilist"),
		).resolves.toEqual({
			accessToken: "tok-secret",
			refreshToken: "ref-secret",
		});
	});

	it("omits secrets from list and at-rest rows", async () => {
		await linkSyncAccount(db, {
			credentials: {
				accessToken: "tok-secret",
				refreshToken: "ref-secret",
			},
			masterKeyBase64: masterKey,
			provider: "anilist",
			userId: "user-1",
		});

		const listed = await listSyncAccounts(db, "user-1");
		expect(listed).toHaveLength(1);
		expect(JSON.stringify(listed)).not.toContain("tok-secret");
		expect(JSON.stringify(listed)).not.toContain("ref-secret");

		const rows = await db.select().from(syncAccountLink).all();
		expect(rows).toHaveLength(1);
		expect(JSON.stringify(rows)).not.toContain("tok-secret");
		expect(rows[0]?.ciphertext.length).toBeGreaterThan(0);
	});
});

describe("sync account store upsert and unlink", () => {
	let db: Awaited<ReturnType<typeof freshDb>>;
	let masterKey: string;

	beforeEach(async () => {
		db = await freshDb();
		masterKey = randomMasterKey();
		await seedUser(db);
	});

	it("upserts the same provider and preserves an existing cursor", async () => {
		await linkSyncAccount(db, {
			credentials: { apiKey: "key-1" },
			masterKeyBase64: masterKey,
			provider: "mal",
			userId: "user-1",
		});
		await db
			.update(syncAccountLink)
			.set({ cursor: "cursor-v1", lastError: "stale" })
			.where(eq(syncAccountLink.userId, "user-1"))
			.run();

		const relinked = await linkSyncAccount(db, {
			credentials: { apiKey: "key-2" },
			externalAccountId: "mal-9",
			masterKeyBase64: masterKey,
			provider: "mal",
			userId: "user-1",
		});
		expect(relinked).toMatchObject({
			cursor: "cursor-v1",
			externalAccountId: "mal-9",
			provider: "mal",
		});
		expect(relinked.lastError).toBeNull();
		await expect(
			readSyncAccountCredentials(db, masterKey, "user-1", "mal"),
		).resolves.toEqual({ apiKey: "key-2" });
		await expect(db.select().from(syncAccountLink).all()).resolves.toHaveLength(
			1,
		);
	});

	it("unlinks a provider and reports missing rows", async () => {
		await linkSyncAccount(db, {
			credentials: { accessToken: "t" },
			masterKeyBase64: masterKey,
			provider: "trakt",
			userId: "user-1",
		});
		await expect(unlinkSyncAccount(db, "user-1", "trakt")).resolves.toBe(true);
		await expect(unlinkSyncAccount(db, "user-1", "trakt")).resolves.toBe(false);
		await expect(listSyncAccounts(db, "user-1")).resolves.toEqual([]);
	});
});
