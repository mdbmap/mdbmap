import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { syncEntitlement } from "@/db/schema";
import {
	createCheckoutSession,
	createPortalSession,
} from "@/lib/billing/sessions";
import { authed } from "@/orpc/base";

const ReturnOriginInput = z.object({
	returnOrigin: z.url(),
});

const status = authed.handler(async ({ context }) => {
	const row = await context.db
		.select({
			status: syncEntitlement.status,
			stripeCustomerId: syncEntitlement.stripeCustomerId,
		})
		.from(syncEntitlement)
		.where(eq(syncEntitlement.userId, context.user.id))
		.get();
	return {
		hasCustomer: (row?.stripeCustomerId?.length ?? 0) > 0,
		status: row?.status ?? ("inactive" as const),
	};
});

const createCheckout = authed
	.input(ReturnOriginInput)
	.handler(async ({ context, input }) => {
		try {
			return await createCheckoutSession(context.db, {
				returnOrigin: input.returnOrigin,
				userId: context.user.id,
			});
		} catch (error) {
			throw new ORPCError("BAD_REQUEST", {
				message:
					error instanceof Error ? error.message : "Could not start checkout.",
			});
		}
	});

const createPortal = authed
	.input(ReturnOriginInput)
	.handler(async ({ context, input }) => {
		try {
			return await createPortalSession(context.db, {
				returnOrigin: input.returnOrigin,
				userId: context.user.id,
			});
		} catch (error) {
			throw new ORPCError("BAD_REQUEST", {
				message:
					error instanceof Error
						? error.message
						: "Could not open the billing portal.",
			});
		}
	});

const billing = { createCheckout, createPortal, status };

export { billing };
