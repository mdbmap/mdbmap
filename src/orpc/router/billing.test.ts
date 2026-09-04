import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { syncEntitlement, user } from "@/db/schema";
import { freshDb } from "@/db/test-helpers";
import type { ORPCContext } from "@/orpc/context";

import { router } from "./index.ts";

const originHeaders = () => new Headers({ origin: "https://example.test" });

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
			headers: originHeaders(),
			resolveSession: () => (userId === undefined ? undefined : { id: userId }),
		} satisfies ORPCContext,
	});

describe("billing.status", () => {
	it("rejects an unauthenticated caller", async () => {
		const db = await seeded();
		await expect(
			clientFor(db, undefined).billing.status(),
		).rejects.toMatchObject({
			code: "UNAUTHORIZED",
		});
	});

	it("reports inactive without a row", async () => {
		const db = await seeded();
		await expect(clientFor(db, "user-1").billing.status()).resolves.toEqual({
			hasCustomer: false,
			status: "inactive",
		});
	});

	it("reports active when entitled", async () => {
		const db = await seeded();
		await db
			.insert(syncEntitlement)
			.values({
				status: "active",
				stripeCustomerId: "cus_1",
				stripeSubscriptionId: "sub_1",
				userId: "user-1",
			})
			.run();
		await expect(clientFor(db, "user-1").billing.status()).resolves.toEqual({
			hasCustomer: true,
			status: "active",
		});
	});
});

describe("billing.createCheckout", () => {
	it("rejects an unauthenticated caller", async () => {
		const db = await seeded();
		await expect(
			clientFor(db, undefined).billing.createCheckout({}),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("rejects when entitlement is already active", async () => {
		const db = await seeded();
		await db
			.insert(syncEntitlement)
			.values({
				status: "active",
				stripeCustomerId: "cus_1",
				stripeSubscriptionId: "sub_1",
				userId: "user-1",
			})
			.run();
		await expect(
			clientFor(db, "user-1").billing.createCheckout({}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});
});

describe("billing.createPortal", () => {
	it("rejects when no Stripe customer is linked", async () => {
		const db = await seeded();
		await expect(
			clientFor(db, "user-1").billing.createPortal({}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
		});
	});
});
