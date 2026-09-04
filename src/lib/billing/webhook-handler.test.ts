import { beforeAll, describe, expect, it, vi } from "vitest";

import { user } from "@/db/schema";
import { freshDb } from "@/db/test-helpers";

import type { handleStripeWebhook as HandleStripeWebhook } from "./webhook-handler.ts";

vi.mock("./stripe-client.ts", () => ({
	createStripe: () => ({
		webhooks: {
			constructEventAsync: async () => {
				const event = await Promise.resolve({
					data: {
						object: {
							client_reference_id: "user-1",
							customer: "cus_1",
							subscription: "sub_1",
						},
					},
					id: "evt_wh_1",
					type: "checkout.session.completed",
				});
				return event;
			},
		},
	}),
	stripeWebhookSecret: () => "whsec_test",
}));

describe("handleStripeWebhook", () => {
	let handleStripeWebhook: typeof HandleStripeWebhook;

	beforeAll(async () => {
		({ handleStripeWebhook } = await import("./webhook-handler.ts"));
	});

	it("rejects missing signatures", async () => {
		const db = await freshDb();
		const response = await handleStripeWebhook(
			db,
			new Request("https://example.test/api/stripe/webhook", {
				body: "{}",
				method: "POST",
			}),
		);
		expect(response.status).toBe(400);
	});

	it("applies a verified checkout event", async () => {
		const db = await freshDb();
		await db
			.insert(user)
			.values({ email: "a@b.test", id: "user-1", name: "Ada" })
			.run();
		const response = await handleStripeWebhook(
			db,
			new Request("https://example.test/api/stripe/webhook", {
				body: "{}",
				headers: { "stripe-signature": "t=1,v1=test" },
				method: "POST",
			}),
		);
		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ result: "applied" });
	});
});
