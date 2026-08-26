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

const expectRejected = async (operation: () => Promise<unknown>) => {
	let rejected = false;
	try {
		await operation();
	} catch {
		rejected = true;
	}
	expect(rejected).toBe(true);
};

const expectEveryOperationRejected = async (user: SessionUser | undefined) => {
	const client = await clientFor(user);
	await expectRejected(async () => client.apiKeys.list());
	await expectRejected(async () => client.apiKeys.mint({ label: "ci" }));
	await expectRejected(async () => client.apiKeys.revoke({ id: "key-1" }));
};

describe("api key admin gate", () => {
	it("rejects every operation for an unauthenticated caller", async () => {
		await expectEveryOperationRejected(undefined);
	});

	it("rejects every operation for a signed-in non-admin", async () => {
		await expectEveryOperationRejected({ id: "user-1" });
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
