import type { ResearchAgent } from "./orchestrate.ts";

const researchAgent: ResearchAgent = ({ continuity }) => ({
	proposals: [],
	residue: continuity.targetServices,
});

export { researchAgent };
