import type { SyncAccountProvider } from "@/db/schema";
import type { SyncAccountCredentials } from "@/lib/sync-accounts";
import type { SyncTargetClient } from "@/lib/sync-push/types.ts";

/**
 * Production factory. Live AniList/MAL HTTP transports are not wired yet;
 * reject so cursors do not advance on a no-op. Tests inject stubs via
 * `createClient`.
 */
const createTargetClient = (
	provider: SyncAccountProvider,
	_credentials: SyncAccountCredentials,
): SyncTargetClient => ({
	provider,
	push: async (): Promise<void> => {
		await Promise.reject(
			new Error(`outbound push transport not implemented for ${provider}`),
		);
	},
});

export { createStubTargetClient } from "./stub.ts";
export { createTargetClient };
