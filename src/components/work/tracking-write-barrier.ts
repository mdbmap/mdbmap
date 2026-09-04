interface AppliedWrite<Result> {
	kind: "applied";
	result: Result;
}

interface DiscardedWrite {
	kind: "discarded";
}

type WriteOutcome<Result> = AppliedWrite<Result> | DiscardedWrite;

interface TrackingWriteBarrier {
	readonly blocked: boolean;
	block: () => void;
	runRemove: <Result>(
		remove: () => Result | Promise<Result>,
	) => Promise<Result>;
	runWrite: <Result>(
		write: () => Result | Promise<Result>,
		compensate: () => unknown,
	) => Promise<WriteOutcome<Result>>;
}

const DISCARDED: DiscardedWrite = { kind: "discarded" };

const applied = <Result>(result: Result): AppliedWrite<Result> => ({
	kind: "applied",
	result,
});

function createTrackingWriteBarrier(): TrackingWriteBarrier {
	let blocked = false;
	let generation = 0;

	return {
		block() {
			blocked = true;
		},
		get blocked() {
			return blocked;
		},
		async runRemove(remove) {
			blocked = true;
			try {
				const result = await remove();
				generation += 1;
				return result;
			} catch (error) {
				blocked = false;
				throw error;
			}
		},
		async runWrite(write, compensate) {
			if (blocked) {
				return DISCARDED;
			}
			const started = generation;
			const result = await write();
			if (generation === started) {
				return applied(result);
			}
			await compensate();
			return DISCARDED;
		},
	};
}

const resultOf = <Result>(
	outcome: WriteOutcome<Result>,
	fallback: Result,
): Result => (outcome.kind === "applied" ? outcome.result : fallback);

export { createTrackingWriteBarrier, resultOf };
export type { TrackingWriteBarrier, WriteOutcome };
