import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { syncAccountLink, syncEntitlement, user } from "@/db/schema";
import { freshDb } from "@/db/test-helpers";
import { randomMasterKey } from "@/lib/provider-config/test-support.ts";
import type { ORPCContext } from "@/orpc/context";

import { router } from "./index.ts";

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

const grantActive = async (db: Awaited<ReturnType<typeof seeded>>) => {
	await db
		.insert(syncEntitlement)
		.values({
			status: "active",
			stripeCustomerId: "cus_test",
			stripeSubscriptionId: "sub_test",
			userId: "user-1",
		})
		.run();
};

const assertNoSecret = (value: unknown, secret: string) => {
	expect(JSON.stringify(value)).not.toContain(secret);
};

describe("sync account entitlement gate", () => {
	it("rejects an unauthenticated caller", async () => {
		const db = await seeded();
		await expect(clientFor(db, undefined).sync.list()).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("forbids list, connect, and disconnect without an active entitlement", async () => {
		const db = await seeded();
		const client = clientFor(db, "user-1");
		await expect(client.sync.list()).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
		await expect(
			client.sync.connect({
				credentials: { accessToken: "tok" },
				provider: "anilist",
			}),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
		await expect(
			client.sync.disconnect({ provider: "anilist" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("forbids a signed-in user with an inactive entitlement", async () => {
		const db = await seeded();
		await db
			.insert(syncEntitlement)
			.values({
				status: "inactive",
				stripeCustomerId: "cus_test",
				userId: "user-1",
			})
			.run();
		await expect(clientFor(db, "user-1").sync.list()).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});
});

describe("sync account link mutations", () => {
	it("connects and lists without secrets", async () => {
		const db = await seeded();
		await grantActive(db);
		const masterKey = randomMasterKey();
		const client = clientFor(db, "user-1", masterKey);

		const linked = await client.sync.connect({
			credentials: {
				accessToken: "tok-should-not-leak",
				refreshToken: "ref-should-not-leak",
			},
			externalAccountId: "ani-42",
			provider: "anilist",
		});
		expect(linked).toMatchObject({
			externalAccountId: "ani-42",
			provider: "anilist",
		});
		expect(linked.cursor).toBeNull();
		expect(linked.lastError).toBeNull();
		assertNoSecret(linked, "tok-should-not-leak");

		const listed = await client.sync.list();
		expect(listed).toEqual([
			expect.objectContaining({
				externalAccountId: "ani-42",
				provider: "anilist",
			}),
		]);
		assertNoSecret(listed, "tok-should-not-leak");
		assertNoSecret(listed, "ref-should-not-leak");
		assertNoSecret(
			await db.select().from(syncAccountLink).all(),
			"tok-should-not-leak",
		);
	});

	it("disconnects a linked account and 404s when missing", async () => {
		const db = await seeded();
		await grantActive(db);
		const client = clientFor(db, "user-1");
		await client.sync.connect({
			credentials: { accessToken: "tok" },
			provider: "anilist",
		});
		await expect(
			client.sync.disconnect({ provider: "anilist" }),
		).resolves.toEqual({ ok: true });
		await expect(client.sync.list()).resolves.toEqual([]);
		await expect(
			client.sync.disconnect({ provider: "anilist" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("rejects connect when neither access token nor API key is provided", async () => {
		const db = await seeded();
		await grantActive(db);
		await expect(
			clientFor(db, "user-1").sync.connect({
				credentials: { refreshToken: "only-refresh" },
				provider: "trakt",
			}),
		).rejects.toBeTruthy();
	});
});
