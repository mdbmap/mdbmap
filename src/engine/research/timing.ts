import { eq } from "drizzle-orm";
import type { Promisable } from "type-fest";

import type { Db } from "@/db";
import { researchTiming, researchTimings } from "@/db/schema";
import type { ResearchTiming as TimingValue } from "@/db/schema";

type ResearchPhase = Exclude<TimingValue, "off">;

interface ResearchTimingStore {
	readonly read: () => Promisable<TimingValue>;
	readonly write: (timing: TimingValue) => Promisable<void>;
}

const isResearchTiming = (value: unknown): value is TimingValue =>
	typeof value === "string" &&
	(researchTimings as readonly string[]).includes(value);

const shouldRunResearch = (
	timing: TimingValue,
	phase: ResearchPhase,
): boolean => timing === phase;

const createMemoryTimingStore = (
	initial: TimingValue = "off",
): ResearchTimingStore => {
	let current = initial;
	return {
		read: () => current,
		write: (timing) => {
			current = timing;
		},
	};
};

const SINGLETON_ID = 1;

const createDbTimingStore = (db: Db): ResearchTimingStore => ({
	read: async () => {
		const rows = await db
			.select({ timing: researchTiming.timing })
			.from(researchTiming)
			.where(eq(researchTiming.id, SINGLETON_ID))
			.all();
		return rows[0]?.timing ?? "off";
	},
	write: async (timing) => {
		const existing = await db
			.select({ id: researchTiming.id })
			.from(researchTiming)
			.where(eq(researchTiming.id, SINGLETON_ID))
			.all();
		if (existing[0] === undefined) {
			await db
				.insert(researchTiming)
				.values({ id: SINGLETON_ID, timing })
				.run();
			return;
		}
		await db
			.update(researchTiming)
			.set({ timing })
			.where(eq(researchTiming.id, SINGLETON_ID))
			.run();
	},
});

export {
	createDbTimingStore,
	createMemoryTimingStore,
	isResearchTiming,
	shouldRunResearch,
};
export { researchTimings } from "@/db/schema";
export type { ResearchTiming } from "@/db/schema";
export type { ResearchPhase, ResearchTimingStore };
