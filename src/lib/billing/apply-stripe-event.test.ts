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

describe("applyStripeEvent checkout.session.completed", () => {
	it("activates entitlement", async () => {
		const db = await seedUser();
		const result = await applyStripeEvent(db, {
			data: {
				object: checkoutObject(),
			},
			id: "evt_checkout_1",
			type: "checkout.session.completed",
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

describe("applyStripeEvent idempotency", () => {
	it("returns duplicate for the same Stripe event id", async () => {
		const db = await seedUser();
		const event = {
			data: {
				object: checkoutObject(),
			},
			id: "evt_dup",
			type: "checkout.session.completed" as const,
		};
		expect(await applyStripeEvent(db, event)).toBe("applied");
		expect(await applyStripeEvent(db, event)).toBe("duplicate");
		const events = await db.select().from(stripeWebhookEvent).all();
		expect(events).toHaveLength(1);
	});
});

describe("applyStripeEvent customer.subscription.deleted", () => {
	it("deactivates entitlement", async () => {
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
		const result = await applyStripeEvent(db, {
			data: {
				object: {
					customer: "cus_1",
					id: "sub_1",
					status: "canceled",
				},
			},
			id: "evt_del",
			type: "customer.subscription.deleted",
		});
		expect(result).toBe("applied");
		const row = await db
			.select({ status: syncEntitlement.status })
			.from(syncEntitlement)
			.where(eq(syncEntitlement.userId, "user-1"))
			.get();
		expect(row?.status).toBe("inactive");
	});
});

describe("applyStripeEvent customer.subscription.updated", () => {
	it("reactivates when status is active", async () => {
		const db = await seedUser();
		await db
			.insert(syncEntitlement)
			.values({
				status: "inactive",
				stripeCustomerId: "cus_1",
				userId: "user-1",
			})
			.run();
		const result = await applyStripeEvent(db, {
			data: {
				object: {
					current_period_end: 1_800_000_000,
					customer: "cus_1",
					id: "sub_2",
					metadata: { userId: "user-1" },
					status: "active",
				},
			},
			id: "evt_upd",
			type: "customer.subscription.updated",
		});
		expect(result).toBe("applied");
		const row = await db
			.select()
			.from(syncEntitlement)
			.where(eq(syncEntitlement.userId, "user-1"))
			.get();
		expect(row).toMatchObject({
			status: "active",
			stripeSubscriptionId: "sub_2",
		});
		expect(row?.periodEnd?.getTime()).toBe(1_800_000_000_000);
	});
});

describe("applyStripeEvent unknown types", () => {
	it("ignores the payload but records the event id", async () => {
		const db = await seedUser();
		const result = await applyStripeEvent(db, {
			data: { object: {} },
			id: "evt_noise",
			type: "invoice.paid",
		});
		expect(result).toBe("ignored");
		const events = await db.select().from(stripeWebhookEvent).all();
		expect(events).toHaveLength(1);
		expect(events[0]).toMatchObject({ id: "evt_noise", type: "invoice.paid" });
	});
});

describe("applyStripeEvent unresolved handled events", () => {
	it("does not record unresolved handled events", async () => {
		const db = await seedUser();
		await expect(
			applyStripeEvent(db, {
				data: {
					object: {
						customer: "cus_unknown",
						subscription: "sub_unknown",
					},
				},
				id: "evt_orphan",
				type: "checkout.session.completed",
			}),
		).rejects.toMatchObject({
			code: "unresolved_subject",
			name: "BillingError",
		});
		const events = await db.select().from(stripeWebhookEvent).all();
		expect(events).toHaveLength(0);
	});
});

describe("applyStripeEvent subscription status fail-closed", () => {
	it("marks past_due subscriptions inactive", async () => {
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
		const result = await applyStripeEvent(db, {
			data: {
				object: {
					customer: "cus_1",
					id: "sub_1",
					status: "past_due",
				},
			},
			id: "evt_past_due",
			type: "customer.subscription.updated",
		});
		expect(result).toBe("applied");
		const row = await db
			.select({ status: syncEntitlement.status })
			.from(syncEntitlement)
			.where(eq(syncEntitlement.userId, "user-1"))
			.get();
		expect(row?.status).toBe("inactive");
	});
});
