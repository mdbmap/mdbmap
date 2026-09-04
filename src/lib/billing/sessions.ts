import { eq } from "drizzle-orm";
import type { Stripe } from "stripe";

import type { Db } from "@/db";
import { syncEntitlement } from "@/db/schema";
import { env } from "@/env";

import {
	billingAlreadyActiveError,
	billingConfigError,
	billingCustomerMissingError,
} from "./errors.ts";
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

const resolveReturnOrigin = (): string => {
	const configured = env.SERVER_URL;
	if (configured === undefined) {
		throw billingConfigError("SERVER_URL is not configured.");
	}
	return configured.replace(/\/$/u, "");
};

const createCheckoutSession = async (
	db: Db,
	input: { headers: Headers | undefined; userId: string },
	stripe?: Stripe,
): Promise<CheckoutResult> => {
	const existing = await db
		.select({
			status: syncEntitlement.status,
			stripeCustomerId: syncEntitlement.stripeCustomerId,
		})
		.from(syncEntitlement)
		.where(eq(syncEntitlement.userId, input.userId))
		.get();
	if (existing?.status === "active") {
		throw billingAlreadyActiveError();
	}
	const returnOrigin = resolveReturnOrigin();

	const client = stripe ?? createStripe();
	const params: Stripe.Checkout.SessionCreateParams = {
		cancel_url: `${returnOrigin}/settings?billing=cancel`,
		client_reference_id: input.userId,
		line_items: [{ price: stripePriceId(), quantity: 1 }],
		metadata: { userId: input.userId },
		mode: "subscription",
		subscription_data: { metadata: { userId: input.userId } },
		success_url: `${returnOrigin}/settings?billing=success`,
	};
	const customerId = linkedCustomerId(existing?.stripeCustomerId);
	if (customerId !== undefined) {
		params.customer = customerId;
	}

	const session = await client.checkout.sessions.create(params, {
		idempotencyKey: `sync-checkout:${input.userId}`,
	});
	if (session.url === null || session.url.length === 0) {
		throw billingConfigError("Stripe Checkout did not return a URL.");
	}
	return { url: session.url };
};

const createPortalSession = async (
	db: Db,
	input: { headers: Headers | undefined; userId: string },
	stripe?: Stripe,
): Promise<PortalResult> => {
	const existing = await db
		.select({ stripeCustomerId: syncEntitlement.stripeCustomerId })
		.from(syncEntitlement)
		.where(eq(syncEntitlement.userId, input.userId))
		.get();
	const customerId = linkedCustomerId(existing?.stripeCustomerId);
	if (customerId === undefined) {
		throw billingCustomerMissingError();
	}
	const returnOrigin = resolveReturnOrigin();
	const client = stripe ?? createStripe();
	const session = await client.billingPortal.sessions.create({
		customer: customerId,
		return_url: `${returnOrigin}/settings`,
	});
	if (session.url.length === 0) {
		throw billingConfigError("Stripe Customer Portal did not return a URL.");
	}
	return { url: session.url };
};

export { createCheckoutSession, createPortalSession };
