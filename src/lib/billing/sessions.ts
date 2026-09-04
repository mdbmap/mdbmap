import { eq } from "drizzle-orm";
import type { Stripe } from "stripe";

import type { Db } from "@/db";
import { syncEntitlement } from "@/db/schema";

import { createStripe, stripePriceId } from "./stripe-client.ts";

interface CheckoutResult {
	url: string;
}

interface PortalResult {
	url: string;
}

const linkedCustomerId = (
	value: string | null | undefined,
): string | undefined => {
	if (value === null || value === undefined || value.length === 0) {
		return undefined;
	}
	return value;
};

const createCheckoutSession = async (
	db: Db,
	input: { returnOrigin: string; userId: string },
	stripe: Stripe = createStripe(),
): Promise<CheckoutResult> => {
	const existing = await db
		.select({ stripeCustomerId: syncEntitlement.stripeCustomerId })
		.from(syncEntitlement)
		.where(eq(syncEntitlement.userId, input.userId))
		.get();

	const params: Stripe.Checkout.SessionCreateParams = {
		cancel_url: `${input.returnOrigin}/settings?billing=cancel`,
		client_reference_id: input.userId,
		line_items: [{ price: stripePriceId(), quantity: 1 }],
		metadata: { userId: input.userId },
		mode: "subscription",
		subscription_data: { metadata: { userId: input.userId } },
		success_url: `${input.returnOrigin}/settings?billing=success`,
	};
	const customerId = linkedCustomerId(existing?.stripeCustomerId);
	if (customerId !== undefined) {
		params.customer = customerId;
	}

	const session = await stripe.checkout.sessions.create(params);
	if (session.url === null || session.url.length === 0) {
		throw new Error("Stripe Checkout did not return a URL.");
	}
	return { url: session.url };
};

const createPortalSession = async (
	db: Db,
	input: { returnOrigin: string; userId: string },
	stripe: Stripe = createStripe(),
): Promise<PortalResult> => {
	const existing = await db
		.select({ stripeCustomerId: syncEntitlement.stripeCustomerId })
		.from(syncEntitlement)
		.where(eq(syncEntitlement.userId, input.userId))
		.get();
	const customerId = linkedCustomerId(existing?.stripeCustomerId);
	if (customerId === undefined) {
		throw new Error("No Stripe customer is linked to this account yet.");
	}
	const session = await stripe.billingPortal.sessions.create({
		customer: customerId,
		return_url: `${input.returnOrigin}/settings`,
	});
	if (session.url.length === 0) {
		throw new Error("Stripe Customer Portal did not return a URL.");
	}
	return { url: session.url };
};

export { createCheckoutSession, createPortalSession };
