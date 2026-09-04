import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { syncEntitlement, user } from "@/db/schema";
import { freshDb } from "@/db/test-helpers";
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
) =>
	createRouterClient(router, {
		context: {
			db,
			resolveSession: () => (userId === undefined ? undefined : { id: userId }),
		} satisfies ORPCContext,
	});

describe("sync.ping entitlement gate", () => {
	it("rejects an unauthenticated caller", async () => {
		const db = await seeded();
		await expect(clientFor(db, undefined).sync.ping()).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("forbids a signed-in user without an entitlement row", async () => {
		const db = await seeded();
		await expect(clientFor(db, "user-1").sync.ping()).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
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
		await expect(clientFor(db, "user-1").sync.ping()).rejects.toMatchObject({
			code: "FORBIDDEN",
		});
	});

	it("allows a signed-in user with an active entitlement", async () => {
		const db = await seeded();
		await db
			.insert(syncEntitlement)
			.values({
				status: "active",
				stripeCustomerId: "cus_test",
				stripeSubscriptionId: "sub_test",
				userId: "user-1",
			})
			.run();
		await expect(clientFor(db, "user-1").sync.ping()).resolves.toEqual({
			ok: true,
		});
	});
});
