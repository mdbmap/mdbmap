import { authed } from "@/orpc/base";
import { requireSyncEntitlement } from "@/orpc/sync-entitlement";

// Placeholder until the outbound sync epic lands. Exists so the entitlement
// gate has a real mutation seam to cover in tests.
const ping = authed.handler(async ({ context }) => {
	await requireSyncEntitlement(context.db, context.user.id);
	return { ok: true as const };
});

const sync = { ping };

export { sync };
