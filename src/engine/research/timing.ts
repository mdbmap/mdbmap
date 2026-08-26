import { eq } from "drizzle-orm";
import type { Promisable } from "type-fest";

import type { Db } from "@/db";
import { researchTiming, researchTimings } from "@/db/schema";
import type { ResearchTiming } from "@/db/schema";

type ResearchPhase = Exclude<ResearchTiming, "off">;

interface ResearchTimingStore {
	readonly read: () => Promisable<ResearchTiming>;
	readonly write: (timing: ResearchTiming) => Promisable<void>;
}

const isResearchTiming = (value: unknown): value is ResearchTiming =>
	typeof value === "string" &&
	(researchTimings as readonly string[]).includes(value);

const shouldRunResearch = (
	timing: ResearchTiming,
	phase: ResearchPhase,
): boolean => timing === phase;

const createMemoryTimingStore = (
	initial: ResearchTiming = "off",
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
	researchTimings,
	shouldRunResearch,
};
export type { ResearchPhase, ResearchTiming, ResearchTimingStore };
