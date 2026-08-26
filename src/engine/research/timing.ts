import type { Promisable } from "type-fest";

const researchTimings = ["before-builds", "after-residue", "off"] as const;
type ResearchTiming = (typeof researchTimings)[number];

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

export {
	createMemoryTimingStore,
	isResearchTiming,
	researchTimings,
	shouldRunResearch,
};
export type { ResearchPhase, ResearchTiming, ResearchTimingStore };
