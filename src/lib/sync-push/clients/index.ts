import type { SyncAccountProvider } from "@/db/schema";
import type { SyncAccountCredentials } from "@/lib/sync-accounts";
import type { SyncTargetClient } from "@/lib/sync-push/types.ts";

import { createAnilistTargetClient } from "./anilist.ts";
import { createMalTargetClient } from "./mal.ts";

/**
 * Production factory. AniList and MAL speak their list APIs; Simkl/Trakt stay
 * unimplemented so cursors do not advance on a no-op. Tests inject stubs via
 * `createClient`.
 */
const createTargetClient = (
	provider: SyncAccountProvider,
	credentials: SyncAccountCredentials,
): SyncTargetClient => {
	if (provider === "anilist") {
		return createAnilistTargetClient({ credentials });
	}
	if (provider === "mal") {
		return createMalTargetClient({ credentials });
	}
	return {
		provider,
		push: async (): Promise<void> => {
			await Promise.reject(
				new Error(`outbound push transport not implemented for ${provider}`),
			);
		},
	};
};

export { createStubTargetClient } from "./stub.ts";
export { createAnilistTargetClient } from "./anilist.ts";
export { createMalTargetClient } from "./mal.ts";
export { createTargetClient };
