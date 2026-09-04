import { ORPCError } from "@orpc/server";
import { eq } from "drizzle-orm";

import type { Db } from "@/db";
import { syncEntitlement } from "@/db/schema";

const SYNC_FORBIDDEN = "Sync requires an active entitlement.";

const requireSyncEntitlement = async (
	db: Db,
	userId: string,
): Promise<void> => {
	const row = await db
		.select({ status: syncEntitlement.status })
		.from(syncEntitlement)
		.where(eq(syncEntitlement.userId, userId))
		.get();
	if (row?.status !== "active") {
		throw new ORPCError("FORBIDDEN", { message: SYNC_FORBIDDEN });
	}
};

export { requireSyncEntitlement, SYNC_FORBIDDEN };
