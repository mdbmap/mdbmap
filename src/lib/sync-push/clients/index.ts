import type { SyncAccountProvider } from "@/db/schema";
import type { SyncAccountCredentials } from "@/lib/sync-accounts";
import type { SyncTargetClient } from "@/lib/sync-push/types.ts";

import { createStubTargetClient } from "./stub.ts";

/** v1 stub transport; credentials keep the job seam production-shaped. */
const createTargetClient = (
	provider: SyncAccountProvider,
	_credentials: SyncAccountCredentials,
): SyncTargetClient => createStubTargetClient(provider);

export { createStubTargetClient } from "./stub.ts";
export { createTargetClient };
