import { and, eq, isNull } from "drizzle-orm";

import type { Db } from "@/db";
import { apiKey } from "@/db/schema";
import type { ApiKeyPlan } from "@/db/schema";

import { hashApiKeySecret } from "./hash.ts";

interface VerifiedApiKey {
	readonly id: string;
	readonly plan: ApiKeyPlan;
}

// A read-only lookup by hash — no write on the verify path, per ADR-0006 (the
// exact per-request D1 write the hand-roll avoids). A wrong secret or a
// revoked key both resolve to `undefined`, indistinguishably to the caller.
const verifyApiKey = async (
	db: Db,
	secret: string,
): Promise<VerifiedApiKey | undefined> => {
	const keyHash = await hashApiKeySecret(secret);
	const rows = await db
		.select({ id: apiKey.id, plan: apiKey.plan })
		.from(apiKey)
		.where(and(eq(apiKey.keyHash, keyHash), isNull(apiKey.revokedAt)))
		.limit(1)
		.all();
	return rows[0];
};

export { verifyApiKey };
export type { VerifiedApiKey };
