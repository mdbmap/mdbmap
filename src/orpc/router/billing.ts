import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import type { SyncEntitlementStatus } from "@/db/schema";
import { syncEntitlement } from "@/db/schema";
import { BillingError } from "@/lib/billing/errors";
import {
	createCheckoutSession,
	createPortalSession,
} from "@/lib/billing/sessions";
import { authed } from "@/orpc/base";

const EmptyInput = z.object({}).strict();

const mapBillingError = (error: unknown, fallback: string): never => {
	if (error instanceof BillingError) {
		if (error.code === "already_active" || error.code === "customer_missing") {
			throw new ORPCError("BAD_REQUEST", { message: error.message });
		}
		throw new ORPCError("INTERNAL_SERVER_ERROR", { message: error.message });
	}
	throw new ORPCError("INTERNAL_SERVER_ERROR", { message: fallback });
};

const status = authed.handler(async ({ context }) => {
	const row = await context.db
		.select({
			status: syncEntitlement.status,
			stripeCustomerId: syncEntitlement.stripeCustomerId,
		})
		.from(syncEntitlement)
		.where(eq(syncEntitlement.userId, context.user.id))
		.get();
	const entitlementStatus: SyncEntitlementStatus = row?.status ?? "inactive";
	return {
		hasCustomer: (row?.stripeCustomerId?.length ?? 0) > 0,
		status: entitlementStatus,
	};
});

const createCheckout = authed.input(EmptyInput).handler(async ({ context }) => {
	try {
		return await createCheckoutSession(context.db, {
			headers: context.headers,
			userId: context.user.id,
		});
	} catch (error) {
		return mapBillingError(error, "Could not start checkout.");
	}
});

const createPortal = authed.input(EmptyInput).handler(async ({ context }) => {
	try {
		return await createPortalSession(context.db, {
			headers: context.headers,
			userId: context.user.id,
		});
	} catch (error) {
		return mapBillingError(error, "Could not open the billing portal.");
	}
});

const billing = { createCheckout, createPortal, status };

export { billing };
