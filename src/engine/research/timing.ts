import type { Promisable } from "type-fest";

// Deployment policy for the agentic research pass (ADR-0004). The admin panel
// (#58) writes this; the orchestrator reads it. Values match the issue wording
// one-for-one so the UI and the pass never disagree on labels.
const researchTimings = ["before-builds", "after-residue", "off"] as const;
type ResearchTiming = (typeof researchTimings)[number];

// Where the build pipeline asks the pass to run. `before-builds` fires ahead of
// the deterministic fan-out; `after-residue` fires only on leftover targets.
type ResearchPhase = Exclude<ResearchTiming, "off">;

// Persistence seam for the timing policy. #58's admin panel writes through the
// same interface; until that lands, callers inject `createMemoryTimingStore`.
interface ResearchTimingStore {
	readonly read: () => Promisable<ResearchTiming>;
	readonly write: (timing: ResearchTiming) => Promisable<void>;
}

const isResearchTiming = (value: unknown): value is ResearchTiming =>
	typeof value === "string" &&
	(researchTimings as readonly string[]).includes(value);

// True when the configured policy wants a pass at this pipeline phase.
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
