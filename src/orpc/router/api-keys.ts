import { desc } from "drizzle-orm";

import { apiKey } from "@/db/schema";
import { issueApiKey, revokeApiKey } from "@/lib/api-key";
import { admin } from "@/orpc/base";
import type { ApiKeyRow, MintedApiKey } from "@/orpc/schema";
import { MintApiKeyInput, RevokeApiKeyInput } from "@/orpc/schema";

// The admin-only API-key surface (issue #55, ADR-0006). Mint returns the
// secret exactly once; every other view of a key exposes only its metadata,
// never the hash or the plaintext.

// Explicit columns, never `select()`: `keyHash` must not leave this module.
const list = admin.handler(async ({ context }): Promise<readonly ApiKeyRow[]> =>
	context.db
		.select({
			createdAt: apiKey.createdAt,
			id: apiKey.id,
			label: apiKey.label,
			plan: apiKey.plan,
			revokedAt: apiKey.revokedAt,
		})
		.from(apiKey)
		.orderBy(desc(apiKey.createdAt))
		.all(),
);

const mint = admin
	.input(MintApiKeyInput)
	.handler(async ({ context, input }): Promise<MintedApiKey> =>
		issueApiKey(context.db, { label: input.label, plan: input.plan }),
	);

const revoke = admin
	.input(RevokeApiKeyInput)
	.handler(async ({ context, input }): Promise<void> =>
		revokeApiKey(context.db, input.id),
	);

const apiKeys = { list, mint, revoke };

export { apiKeys };
