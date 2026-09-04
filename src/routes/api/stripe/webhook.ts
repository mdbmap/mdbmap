import { createFileRoute } from "@tanstack/react-router";

import { resolveDb } from "@/db";
import { handleStripeWebhook } from "@/lib/billing/webhook-handler";

export const Route = createFileRoute("/api/stripe/webhook")({
	server: {
		handlers: {
			POST: async ({ request }) => {
				const db = await resolveDb();
				return handleStripeWebhook(db, request);
			},
		},
	},
});
