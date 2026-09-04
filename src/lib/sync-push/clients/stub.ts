import type { SyncAccountProvider } from "@/db/schema";
import type {
	SyncTargetClient,
	TargetWriteBatch,
} from "@/lib/sync-push/types.ts";

interface StubTargetClient extends SyncTargetClient {
	readonly batches: TargetWriteBatch[];
}

const createStubTargetClient = (
	provider: SyncAccountProvider,
	handler?: (batch: TargetWriteBatch) => Promise<void>,
): StubTargetClient => {
	const batches: TargetWriteBatch[] = [];
	return {
		batches,
		provider,
		push: async (batch) => {
			batches.push(batch);
			if (handler !== undefined) {
				await handler(batch);
			}
		},
	};
};

export { createStubTargetClient };
export type { StubTargetClient };
