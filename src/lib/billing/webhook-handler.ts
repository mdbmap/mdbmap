import type { Db } from "@/db";

import { applyStripeEvent } from "./apply-stripe-event.ts";
import type { StripeEventLike } from "./apply-stripe-event.ts";
import { BillingError } from "./errors.ts";
import { createStripe, stripeWebhookSecret } from "./stripe-client.ts";

const toEventObject = (value: unknown): Record<string, unknown> => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return {};
	}
	const record: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		record[key] = entry;
	}
	return record;
};

const handleStripeWebhook = async (
	db: Db,
	request: Request,
): Promise<Response> => {
	const signature = request.headers.get("stripe-signature");
	if (signature === null || signature.length === 0) {
		return Response.json(
			{ error: "Missing stripe-signature" },
			{ status: 400 },
		);
	}
	const payload = await request.text();
	const stripe = createStripe();
	let event;
	try {
		event = await stripe.webhooks.constructEventAsync(
			payload,
			signature,
			stripeWebhookSecret(),
		);
	} catch {
		return Response.json({ error: "Invalid signature" }, { status: 400 });
	}
	const stripeEvent: StripeEventLike = {
		data: { object: toEventObject(event.data.object) },
		id: event.id,
		type: event.type,
	};
	try {
		const result = await applyStripeEvent(db, stripeEvent);
		return Response.json({ result }, { status: 200 });
	} catch (error) {
		if (error instanceof BillingError && error.code === "unresolved_subject") {
			return Response.json({ error: error.message }, { status: 500 });
		}
		throw error;
	}
};

export { handleStripeWebhook };
