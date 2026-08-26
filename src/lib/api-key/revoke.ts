import { eq } from "drizzle-orm";

import type { Db } from "@/db";
import { apiKey } from "@/db/schema";

// Idempotent: revoking an already-revoked or unknown id is not an error, since
// the caller's intent (this id must not verify) already holds either way.
const revokeApiKey = async (db: Db, id: string): Promise<void> => {
	await db.update(apiKey).set({ revokedAt: new Date() }).where(eq(apiKey.id, id)).run();
};

export { revokeApiKey };
