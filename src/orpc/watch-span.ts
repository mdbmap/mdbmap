const isoDay = (value: Date): string => value.toISOString().slice(0, 10);

interface WatchSpan {
	finishedAt: string | undefined;
	startedAt: string | undefined;
}

const watchSpan = (
	locators: readonly string[],
	watchedAt: ReadonlyMap<string, Date>,
): WatchSpan => {
	let earliestMs: number | undefined;
	let latestMs: number | undefined;
	let watchedCount = 0;
	for (const locator of locators) {
		const at = watchedAt.get(locator);
		if (at === undefined) {
			continue;
		}
		watchedCount += 1;
		const millis = at.getTime();
		if (earliestMs === undefined || millis < earliestMs) {
			earliestMs = millis;
		}
		if (latestMs === undefined || millis > latestMs) {
			latestMs = millis;
		}
	}
	if (earliestMs === undefined || latestMs === undefined) {
		return { finishedAt: undefined, startedAt: undefined };
	}
	const startedAt = isoDay(new Date(earliestMs));
	const finishedAt =
		locators.length > 0 && watchedCount === locators.length
			? isoDay(new Date(latestMs))
			: undefined;
	return { finishedAt, startedAt };
};

export { watchSpan };
export type { WatchSpan };
