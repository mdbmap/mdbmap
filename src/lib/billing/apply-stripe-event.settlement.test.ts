import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { stripeWebhookEvent, syncEntitlement, user } from "@/db/schema";
import { freshDb } from "@/db/test-helpers";

import { applyStripeEvent } from "./apply-stripe-event.ts";

const seedUser = async () => {
	const db = await freshDb();
	await db
		.insert(user)
		.values({ email: "a@b.test", id: "user-1", name: "Ada" })
		.run();
	return db;
};

const checkoutObject = (
	paymentStatus: "paid" | "unpaid" = "paid",
): Record<string, unknown> => ({
	client_reference_id: "user-1",
	customer: "cus_1",
	payment_status: paymentStatus,
	subscription: "sub_1",
});

describe("applyStripeEvent checkout unpaid settlement", () => {
	it("does not activate while payment_status is unpaid", async () => {
		const db = await seedUser();
		const result = await applyStripeEvent(db, {
			data: {
				object: checkoutObject("unpaid"),
			},
			id: "evt_unpaid",
			type: "checkout.session.completed",
		});
		expect(result).toBe("ignored");
		const row = await db
			.select()
			.from(syncEntitlement)
			.where(eq(syncEntitlement.userId, "user-1"))
			.get();
		expect(row).toBeUndefined();
		const events = await db.select().from(stripeWebhookEvent).all();
		expect(events).toHaveLength(1);
	});

	it("activates on async_payment_succeeded after an unpaid completed", async () => {
		const db = await seedUser();
		await applyStripeEvent(db, {
			data: {
				object: checkoutObject("unpaid"),
			},
			id: "evt_unpaid_first",
			type: "checkout.session.completed",
		});
		const result = await applyStripeEvent(db, {
			data: {
				object: checkoutObject(),
			},
			id: "evt_async_paid",
			type: "checkout.session.async_payment_succeeded",
		});
		expect(result).toBe("applied");
		const row = await db
			.select()
			.from(syncEntitlement)
			.where(eq(syncEntitlement.userId, "user-1"))
			.get();
		expect(row).toMatchObject({
			status: "active",
			stripeCustomerId: "cus_1",
			stripeSubscriptionId: "sub_1",
		});
	});
});

describe("applyStripeEvent stale subscription.updated after deleted", () => {
	it("does not restore entitlement for the deleted subscription id", async () => {
		const db = await seedUser();
		await db
			.insert(syncEntitlement)
			.values({
				status: "active",
				stripeCustomerId: "cus_1",
				stripeSubscriptionId: "sub_1",
				userId: "user-1",
			})
			.run();
		await applyStripeEvent(db, {
			data: {
				object: {
					customer: "cus_1",
					id: "sub_1",
					status: "canceled",
				},
			},
			id: "evt_del_then_stale",
			type: "customer.subscription.deleted",
		});
		const result = await applyStripeEvent(db, {
			data: {
				object: {
					customer: "cus_1",
					id: "sub_1",
					status: "active",
				},
			},
			id: "evt_stale_upd",
			type: "customer.subscription.updated",
		});
		expect(result).toBe("ignored");
		const row = await db
			.select({ status: syncEntitlement.status })
			.from(syncEntitlement)
			.where(eq(syncEntitlement.userId, "user-1"))
			.get();
		expect(row?.status).toBe("inactive");
	});
});

describe("applyStripeEvent checkout payment_status fail-closed", () => {
	it("ignores completed checkout when payment_status is missing", async () => {
		const db = await seedUser();
		const result = await applyStripeEvent(db, {
			data: {
				object: {
					client_reference_id: "user-1",
					customer: "cus_1",
					subscription: "sub_1",
				},
			},
			id: "evt_missing_payment",
			type: "checkout.session.completed",
		});
		expect(result).toBe("ignored");
		const row = await db
			.select()
			.from(syncEntitlement)
			.where(eq(syncEntitlement.userId, "user-1"))
			.get();
		expect(row).toBeUndefined();
	});
});

describe("applyStripeEvent in-flight claims", () => {
	it("returns in_flight when a claim exists without processedAt", async () => {
		const db = await seedUser();
		await db
			.insert(stripeWebhookEvent)
			.values({ id: "evt_inflight", type: "invoice.paid" })
			.run();
		const result = await applyStripeEvent(db, {
			data: { object: {} },
			id: "evt_inflight",
			type: "invoice.paid",
		});
		expect(result).toBe("in_flight");
	});
});
