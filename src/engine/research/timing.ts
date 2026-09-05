import type { Promisable } from "type-fest";

import type { Db } from "@/db";
import { researchTimings } from "@/db/schema";
import type { ResearchTiming as TimingValue } from "@/db/schema";
import { getResearchTiming, setResearchTiming } from "@/lib/research-policy";

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

// Adapter over the admin-backed research_policy store from #101.
const createDbTimingStore = (db: Db): ResearchTimingStore => ({
	read: async () => getResearchTiming(db),
	write: async (timing) => {
		await setResearchTiming(db, timing);
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
