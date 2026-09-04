import { eq } from "drizzle-orm";

import type { Db } from "@/db";
import type { SyncEntitlementStatus } from "@/db/schema";
import { stripeWebhookEvent, syncEntitlement } from "@/db/schema";

import { unresolvedBillingSubjectError } from "./errors.ts";

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

const HANDLED_EVENT_TYPES = new Set([
	"checkout.session.async_payment_succeeded",
	"checkout.session.completed",
	"customer.subscription.created",
	"customer.subscription.deleted",
	"customer.subscription.updated",
]);

const PAID_CHECKOUT_STATUSES = new Set(["paid", "no_payment_required"]);

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

const checkoutPaymentSettled = (object: Record<string, unknown>): boolean => {
	const paymentStatus = asString(object["payment_status"]);
	if (paymentStatus === undefined) {
		return true;
	}
	return PAID_CHECKOUT_STATUSES.has(paymentStatus);
};

const applyCheckoutSessionCompleted = async (
	db: Db,
	object: Record<string, unknown>,
): Promise<"applied" | "ignored" | "unresolved"> => {
	const userId =
		asString(object["client_reference_id"]) ?? metadataUserId(object);
	if (userId === undefined) {
		return "unresolved";
	}
	if (!checkoutPaymentSettled(object)) {
		return "ignored";
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
	return "applied";
};

const shouldIgnoreStaleReactivation = async (
	db: Db,
	input: {
		ignoreStaleReactivation: boolean;
		nextStatus: SyncEntitlementStatus;
		subscriptionId: string | undefined;
		userId: string;
	},
): Promise<boolean> => {
	if (
		!input.ignoreStaleReactivation ||
		input.nextStatus !== "active" ||
		input.subscriptionId === undefined
	) {
		return false;
	}
	const existing = await db
		.select({
			status: syncEntitlement.status,
			stripeSubscriptionId: syncEntitlement.stripeSubscriptionId,
		})
		.from(syncEntitlement)
		.where(eq(syncEntitlement.userId, input.userId))
		.get();
	return (
		existing?.status === "inactive" &&
		existing.stripeSubscriptionId === input.subscriptionId
	);
};

const applySubscription = async (
	db: Db,
	object: Record<string, unknown>,
	options?: {
		ignoreStaleReactivation?: boolean;
		statusOverride?: SyncEntitlementStatus;
	},
): Promise<"applied" | "ignored" | "unresolved"> => {
	const customerId = asString(object["customer"]);
	const userId =
		metadataUserId(object) ?? (await userIdForCustomer(db, customerId));
	if (userId === undefined) {
		return "unresolved";
	}
	const subscriptionId = asString(object["id"]);
	const nextStatus =
		options?.statusOverride ?? subscriptionStatus(asString(object["status"]));
	if (
		await shouldIgnoreStaleReactivation(db, {
			ignoreStaleReactivation: options?.ignoreStaleReactivation === true,
			nextStatus,
			subscriptionId,
			userId,
		})
	) {
		return "ignored";
	}
	const write: EntitlementWrite = {
		status: nextStatus,
		userId,
	};
	const periodEnd = asUnixDate(object["current_period_end"]);
	if (periodEnd !== undefined) {
		write.periodEnd = periodEnd;
	}
	if (customerId !== undefined) {
		write.stripeCustomerId = customerId;
	}
	if (subscriptionId !== undefined) {
		write.stripeSubscriptionId = subscriptionId;
	}
	await upsertEntitlement(db, write);
	return "applied";
};

const claimStripeEvent = async (
	db: Db,
	event: StripeEventLike,
): Promise<boolean> => {
	const claimed = await db
		.insert(stripeWebhookEvent)
		.values({ id: event.id, type: event.type })
		.onConflictDoNothing()
		.returning({ id: stripeWebhookEvent.id })
		.all();
	return claimed.length > 0;
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

const applyStripeEvent = async (
	db: Db,
	event: StripeEventLike,
): Promise<ApplyResult> => {
	const claimed = await claimStripeEvent(db, event);
	if (!claimed) {
		return "duplicate";
	}

	try {
		const { object } = event.data;
		let outcome: "applied" | "ignored" | "unresolved" = "ignored";
		switch (event.type) {
			case "checkout.session.async_payment_succeeded":
			case "checkout.session.completed": {
				outcome = await applyCheckoutSessionCompleted(db, object);
				break;
			}
			case "customer.subscription.created": {
				outcome = await applySubscription(db, object);
				break;
			}
			case "customer.subscription.updated": {
				outcome = await applySubscription(db, object, {
					ignoreStaleReactivation: true,
				});
				break;
			}
			case "customer.subscription.deleted": {
				outcome = await applySubscription(db, object, {
					statusOverride: "inactive",
				});
				break;
			}
			default: {
				outcome = "ignored";
				break;
			}
		}

		if (outcome === "unresolved" && HANDLED_EVENT_TYPES.has(event.type)) {
			throw unresolvedBillingSubjectError(event.type);
		}

		return outcome === "applied" ? "applied" : "ignored";
	} catch (error) {
		await releaseStripeEventClaim(db, event.id);
		throw error;
	}
};

export { applyStripeEvent };
export type { ApplyResult, StripeEventLike };
