import { eq } from "drizzle-orm";

import type { Db } from "@/db";
import { stripeWebhookEvent } from "@/db/schema";

type ClaimResult = "claimed" | "duplicate" | "in_flight";

const claimStripeEvent = async (
	db: Db,
	event: { id: string; type: string },
): Promise<ClaimResult> => {
	const claimed = await db
		.insert(stripeWebhookEvent)
		.values({ id: event.id, type: event.type })
		.onConflictDoNothing()
		.returning({ id: stripeWebhookEvent.id })
		.all();
	if (claimed.length > 0) {
		return "claimed";
	}
	const existing = await db
		.select({ processedAt: stripeWebhookEvent.processedAt })
		.from(stripeWebhookEvent)
		.where(eq(stripeWebhookEvent.id, event.id))
		.get();
	if (existing === undefined || !(existing.processedAt instanceof Date)) {
		return "in_flight";
	}
	return "duplicate";
};

const completeStripeEventClaim = async (
	db: Db,
	eventId: string,
): Promise<void> => {
	await db
		.update(stripeWebhookEvent)
		.set({ processedAt: new Date() })
		.where(eq(stripeWebhookEvent.id, eventId))
		.run();
};

const releaseStripeEventClaim = async (
	db: Db,
	eventId: string,
): Promise<void> => {
	await db
		.delete(stripeWebhookEvent)
		.where(eq(stripeWebhookEvent.id, eventId))
		.run();
};

export { claimStripeEvent, completeStripeEventClaim, releaseStripeEventClaim };
export type { ClaimResult };
