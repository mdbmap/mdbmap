import { Stripe } from "stripe";

import { env } from "@/env";

const missing = (name: string): never => {
	throw new Error(`${name} is not configured.`);
};

const stripeSecret = (): string =>
	env.STRIPE_SECRET_KEY ?? missing("STRIPE_SECRET_KEY");

const stripeWebhookSecret = (): string =>
	env.STRIPE_WEBHOOK_SECRET ?? missing("STRIPE_WEBHOOK_SECRET");

const stripePriceId = (): string =>
	env.STRIPE_PRICE_ID ?? missing("STRIPE_PRICE_ID");

const createStripe = (secretKey = stripeSecret()): Stripe =>
	new Stripe(secretKey, {
		httpClient: Stripe.createFetchHttpClient(),
	});

export { createStripe, stripePriceId, stripeSecret, stripeWebhookSecret };
