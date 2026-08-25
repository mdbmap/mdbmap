import type { CommunityScore, RateableUnit } from "@/orpc/schema";

import type { CommunityScoreProvider } from "./types.ts";

// STUB — replaced by #8, which derives mean + count from personal_rating rows.
const communityScoreProvider: CommunityScoreProvider = {
	scoreFor: (unit: RateableUnit): CommunityScore =>
		unit.kind === "part"
			? { count: 128, mean: 8.4 }
			: { count: 0, mean: undefined },
};

export { communityScoreProvider };
