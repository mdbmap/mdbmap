import type { Db } from "./index.ts";

type PreparedBatch = [D1PreparedStatement, ...D1PreparedStatement[]];
type BatchResults = Awaited<ReturnType<D1Database["batch"]>>;

interface AtomicBatchResult {
	readonly acquired: boolean;
	readonly results: BatchResults;
}

type BuildAtomicBatch = (
	database: D1Database,
	operationId: string,
) => PreparedBatch;

const runAtomicBatch = async (
	db: Db,
	build: BuildAtomicBatch,
): Promise<AtomicBatchResult> => {
	const results = await db.$client.batch(
		build(db.$client, crypto.randomUUID()),
	);
	const [gate] = results;
	if (gate === undefined) {
		throw new Error("atomic batch returned no gate result");
	}
	return { acquired: gate.results.length > 0, results };
};

export { runAtomicBatch };
export type { AtomicBatchResult, BuildAtomicBatch, PreparedBatch };
