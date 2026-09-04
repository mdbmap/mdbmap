import { eq } from "drizzle-orm";

import type { Db } from "@/db";
import type { SyncEntitlementStatus } from "@/db/schema";
import { stripeWebhookEvent, syncEntitlement } from "@/db/schema";

interface StripeEventLike {
	data: { object: Record<string, unknown> };
	id: string;
	type: string;
}

type ApplyResult = "applied" | "duplicate" | "ignored";

interface EntitlementWrite {
	status: SyncEntitlementStatus;
	userId: string;
	periodEnd?: Date;
	stripeCustomerId?: string;
	stripeSubscriptionId?: string;
}

const asString = (value: unknown): string | undefined =>
	typeof value === "string" && value.length > 0 ? value : undefined;

const asUnixDate = (value: unknown): Date | undefined => {
	if (typeof value !== "number" || !Number.isFinite(value)) {
		return undefined;
	}
	return new Date(value * 1000);
};

const asRecord = (value: unknown): Record<string, unknown> | undefined => {
	if (value === null || typeof value !== "object" || Array.isArray(value)) {
		return undefined;
	}
	const record: Record<string, unknown> = {};
	for (const [key, entry] of Object.entries(value)) {
		record[key] = entry;
	}
	return record;
};

const metadataUserId = (
	object: Record<string, unknown>,
): string | undefined => {
	const metadata = asRecord(object["metadata"]);
	if (metadata === undefined) {
		return undefined;
	}
	return asString(metadata["userId"]);
};

const subscriptionStatus = (
	status: string | undefined,
): SyncEntitlementStatus => {
	if (status === "active" || status === "trialing") {
		return "active";
	}
	return "inactive";
};

const upsertEntitlement = async (
	db: Db,
	input: EntitlementWrite,
): Promise<void> => {
	const values: typeof syncEntitlement.$inferInsert = {
		status: input.status,
		userId: input.userId,
	};
	if (input.periodEnd !== undefined) {
		values.periodEnd = input.periodEnd;
	}
	if (input.stripeCustomerId !== undefined) {
		values.stripeCustomerId = input.stripeCustomerId;
	}
	if (input.stripeSubscriptionId !== undefined) {
		values.stripeSubscriptionId = input.stripeSubscriptionId;
	}
	await db
		.insert(syncEntitlement)
		.values(values)
		.onConflictDoUpdate({
			set: {
				...(input.periodEnd === undefined
					? {}
					: { periodEnd: input.periodEnd }),
				status: input.status,
				...(input.stripeCustomerId === undefined
					? {}
					: { stripeCustomerId: input.stripeCustomerId }),
				...(input.stripeSubscriptionId === undefined
					? {}
					: { stripeSubscriptionId: input.stripeSubscriptionId }),
			},
			target: syncEntitlement.userId,
		})
		.run();
};

const userIdForCustomer = async (
	db: Db,
	customerId: string | undefined,
): Promise<string | undefined> => {
	if (customerId === undefined) {
		return undefined;
	}
	const row = await db
		.select({ userId: syncEntitlement.userId })
		.from(syncEntitlement)
		.where(eq(syncEntitlement.stripeCustomerId, customerId))
		.get();
	return row?.userId;
};

const applyCheckoutSessionCompleted = async (
	db: Db,
	object: Record<string, unknown>,
): Promise<boolean> => {
	const userId =
		asString(object["client_reference_id"]) ?? metadataUserId(object);
	if (userId === undefined) {
		return false;
	}
	const write: EntitlementWrite = {
		status: "active",
		userId,
	};
	const customerId = asString(object["customer"]);
	if (customerId !== undefined) {
		write.stripeCustomerId = customerId;
	}
	const subscriptionId = asString(object["subscription"]);
	if (subscriptionId !== undefined) {
		write.stripeSubscriptionId = subscriptionId;
	}
	await upsertEntitlement(db, write);
	return true;
};

const applySubscription = async (
	db: Db,
	object: Record<string, unknown>,
	statusOverride?: SyncEntitlementStatus,
): Promise<boolean> => {
	const customerId = asString(object["customer"]);
	const userId =
		metadataUserId(object) ?? (await userIdForCustomer(db, customerId));
	if (userId === undefined) {
		return false;
	}
	const write: EntitlementWrite = {
		status: statusOverride ?? subscriptionStatus(asString(object["status"])),
		userId,
	};
	const periodEnd = asUnixDate(object["current_period_end"]);
	if (periodEnd !== undefined) {
		write.periodEnd = periodEnd;
	}
	if (customerId !== undefined) {
		write.stripeCustomerId = customerId;
	}
	const subscriptionId = asString(object["id"]);
	if (subscriptionId !== undefined) {
		write.stripeSubscriptionId = subscriptionId;
	}
	await upsertEntitlement(db, write);
	return true;
};

const applyStripeEvent = async (
	db: Db,
	event: StripeEventLike,
): Promise<ApplyResult> => {
	const seen = await db
		.select({ id: stripeWebhookEvent.id })
		.from(stripeWebhookEvent)
		.where(eq(stripeWebhookEvent.id, event.id))
		.get();
	if (seen !== undefined) {
		return "duplicate";
	}

	const { object } = event.data;
	let wrote = false;
	switch (event.type) {
		case "checkout.session.completed": {
			wrote = await applyCheckoutSessionCompleted(db, object);
			break;
		}
		case "customer.subscription.created":
		case "customer.subscription.updated": {
			wrote = await applySubscription(db, object);
			break;
		}
		case "customer.subscription.deleted": {
			wrote = await applySubscription(db, object, "inactive");
			break;
		}
		default: {
			wrote = false;
			break;
		}
	}

	await db
		.insert(stripeWebhookEvent)
		.values({ id: event.id, type: event.type })
		.run();

	return wrote ? "applied" : "ignored";
};

export { applyStripeEvent };
export type { ApplyResult, StripeEventLike };
