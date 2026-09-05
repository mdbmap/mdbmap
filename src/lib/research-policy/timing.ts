import { eq } from "drizzle-orm";

import type { Db } from "@/db";
import { DEFAULT_RESEARCH_TIMING, researchPolicy } from "@/db/schema";
import type { ResearchTiming } from "@/db/schema";

const RESEARCH_POLICY_ID = "default";
const DEFAULT_TIMING: ResearchTiming = DEFAULT_RESEARCH_TIMING;

const getResearchTiming = async (db: Db): Promise<ResearchTiming> => {
	const row = await db
		.select({ timing: researchPolicy.timing })
		.from(researchPolicy)
		.where(eq(researchPolicy.id, RESEARCH_POLICY_ID))
		.get();
	return row?.timing ?? DEFAULT_TIMING;
};

const setResearchTiming = async (
	db: Db,
	timing: ResearchTiming,
): Promise<ResearchTiming> => {
	await db
		.insert(researchPolicy)
		.values({ id: RESEARCH_POLICY_ID, timing })
		.onConflictDoUpdate({
			set: { timing },
			target: researchPolicy.id,
		})
		.run();
	return timing;
};

export {
	DEFAULT_TIMING,
	RESEARCH_POLICY_ID,
	getResearchTiming,
	setResearchTiming,
};
