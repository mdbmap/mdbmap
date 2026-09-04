import { Stripe } from "stripe";

import { env } from "@/env";

import { billingConfigError } from "./errors.ts";

const stripeSecretKey = (): string => {
	const value = env.STRIPE_SECRET_KEY;
	if (value === undefined) {
		throw billingConfigError("STRIPE_SECRET_KEY is not configured.");
	}
	return value;
};

const stripeWebhookSecret = (): string => {
	const value = env.STRIPE_WEBHOOK_SECRET;
	if (value === undefined) {
		throw billingConfigError("STRIPE_WEBHOOK_SECRET is not configured.");
	}
	return value;
};

const stripePriceId = (): string => {
	const value = env.STRIPE_PRICE_ID;
	if (value === undefined) {
		throw billingConfigError("STRIPE_PRICE_ID is not configured.");
	}
	return value;
};

const createStripe = (secretKey = stripeSecretKey()): Stripe =>
	new Stripe(secretKey, {
		httpClient: Stripe.createFetchHttpClient(),
	});

export { createStripe, stripePriceId, stripeWebhookSecret };
