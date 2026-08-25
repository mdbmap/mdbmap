interface RateLimiterDeps {
	intervalMs: number;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
}

interface RateLimiter {
	run: <Result>(task: () => Promise<Result>) => Promise<Result>;
}

const defaultSleep = async (ms: number): Promise<void> => {
	const { promise, resolve } = Promise.withResolvers();
	setTimeout(resolve, ms);
	await promise;
};

// Serialises tasks through a single-lane queue and spaces each start at least
// `intervalMs` after the previous one, so concurrent callers can never exceed
// one request per interval (AniDB's one-request-per-two-seconds flood rule).
const createRateLimiter = (deps: RateLimiterDeps): RateLimiter => {
	const { intervalMs, now = Date.now, sleep = defaultSleep } = deps;
	let tail: Promise<number> = Promise.resolve(Number.NEGATIVE_INFINITY);

	const run = async <Result>(task: () => Promise<Result>): Promise<Result> => {
		const previous = tail;
		const startedAt = (async (): Promise<number> => {
			const last = await previous;
			const wait = last + intervalMs - now();
			if (wait > 0) {
				await sleep(wait);
			}
			return now();
		})();
		tail = startedAt;
		await startedAt;
		const result = await task();
		return result;
	};

	return { run };
};

export { createRateLimiter };
export type { RateLimiter };
