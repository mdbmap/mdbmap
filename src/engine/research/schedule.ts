import type { Db } from "@/db";
import type { ResearchTiming } from "@/db/schema";
import { getResearchTiming } from "@/lib/research-policy";

// ADR-0004 deployment policy → when the agentic pass (#59) runs relative to
// overflow builds. `off` skips the pass; otherwise the orchestrator places it
// before builds or after deterministic residue.
type ResearchSchedule =
	| { readonly run: false }
	| { readonly run: true; readonly when: Exclude<ResearchTiming, "off"> };

const resolveResearchSchedule = async (db: Db): Promise<ResearchSchedule> => {
	const timing = await getResearchTiming(db);
	if (timing === "off") {
		return { run: false };
	}
	return { run: true, when: timing };
};

export { resolveResearchSchedule };
export type { ResearchSchedule };
