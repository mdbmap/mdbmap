import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { freshDb } from "@/db/test-helpers";
import type { ORPCContext, SessionUser } from "@/orpc/context";

import { router } from "./index.ts";

const clientFor = async (user: SessionUser | undefined) =>
	createRouterClient(router, {
		context: {
			db: await freshDb(),
			resolveSession: () => user,
		} satisfies ORPCContext,
	});

describe("api key admin gate", () => {
	it("rejects every operation for unauthenticated and non-admin callers", async () => {
		const deniedUsers: readonly (SessionUser | undefined)[] = [undefined, { id: "user-1" }];

		for (const user of deniedUsers) {
			const client = await clientFor(user);
			const results = await Promise.allSettled([
				client.apiKeys.list(),
				client.apiKeys.mint({ label: "ci" }),
				client.apiKeys.revoke({ id: "key-1" }),
			]);
			expect(results.every(({ status }) => status === "rejected")).toBe(true);
		}
	});
});

describe("api key admin surface", () => {
	const adminUser: SessionUser = { id: "admin-1", role: "admin" };

	it("mints a key, returning the secret exactly once", async () => {
		const client = await clientFor(adminUser);
		const minted = await client.apiKeys.mint({ label: "partner-a" });

		expect(minted.secret).toMatch(/^mdbmap_/u);
		expect(minted.plan).toBe("free");

		const rows = await client.apiKeys.list();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({ id: minted.id, label: "partner-a" });
		expect(rows[0]).not.toHaveProperty("secret");
		expect(rows[0]).not.toHaveProperty("keyHash");
	});

	it("revokes a minted key", async () => {
		const client = await clientFor(adminUser);
		const minted = await client.apiKeys.mint({ label: "partner-b" });

		await client.apiKeys.revoke({ id: minted.id });

		const rows = await client.apiKeys.list();
		expect(rows[0]?.revokedAt).not.toBeNull();
	});
});
