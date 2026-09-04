import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import {
	syncAccountLink,
	syncEntitlement,
	user,
	watchStatus,
} from "@/db/schema";
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

	it("forbids list and connect without an active entitlement", async () => {
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
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});

	it("forbids list and connect when entitlement is inactive", async () => {
		const db = await seeded();
		await db
			.insert(syncEntitlement)
			.values({
				status: "inactive",
				stripeCustomerId: "cus_test",
				userId: "user-1",
			})
			.run();
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
	});

	it("allows disconnect after entitlement lapses", async () => {
		const db = await seeded();
		await grantActive(db);
		const client = clientFor(db, "user-1");
		await client.sync.connect({
			credentials: { accessToken: "tok" },
			provider: "anilist",
		});
		await db.update(syncEntitlement).set({ status: "inactive" }).run();
		await expect(
			client.sync.disconnect({ provider: "anilist" }),
		).resolves.toEqual({ ok: true });
		await expect(
			client.sync.disconnect({ provider: "anilist" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
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

describe("sync.push", () => {
	it("forbids push without an active entitlement", async () => {
		const db = await seeded();
		await expect(
			clientFor(db, "user-1").sync.push({ continuityId: "continuity:1" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("runs entitlement-gated push without advancing cursors until live transport exists", async () => {
		const db = await seeded();
		await grantActive(db);
		const masterKey = randomMasterKey();
		const client = clientFor(db, "user-1", masterKey);
		await client.sync.connect({
			credentials: { accessToken: "tok-push" },
			externalAccountId: "ani-1",
			provider: "anilist",
		});
		await db
			.insert(watchStatus)
			.values({
				continuityKey: "continuity:1",
				status: "completed",
				userId: "user-1",
			})
			.run();

		const engine = {
			resolveContinuity: async () => {
				await Promise.resolve();
				return {
					continuityId: "continuity:1",
					mediaKind: "anime" as const,
					segments: [
						{
							instalments: ["anidb:1#1"],
							kind: "episodic" as const,
							members: { anilist: "10" },
						},
					],
				};
			},
		};

		const pushClient = createRouterClient(router, {
			context: {
				db,
				engine,
				providerConfigMasterKey: masterKey,
				resolveSession: () => ({ id: "user-1" }),
			} satisfies ORPCContext,
		});

		const result = await pushClient.sync.push({ continuityId: "continuity:1" });
		expect(result.targets).toHaveLength(1);
		const [target] = result.targets;
		expect(target).toBeDefined();
		if (target === undefined) {
			throw new Error("expected push target result");
		}
		expect(target.ok).toBe(false);
		if (target.ok) {
			throw new Error("expected failed push target");
		}
		expect(target.provider).toBe("anilist");
		expect(target.error).toContain("not implemented");
		expect(result.warningCount).toBe(0);
		assertNoSecret(result, "tok-push");

		const listed = await client.sync.list();
		const [account] = listed;
		expect(account?.cursor).toBeNull();
		expect(account?.lastError ?? "").toContain("not implemented");
	});
});
