import { and, eq } from "drizzle-orm";

import { personalRating } from "@/db/schema";
import type { Db } from "@/orpc/context";
import type { CommunityScore, RateableUnit } from "@/orpc/schema";

import type { CommunityScoreProvider } from "./types.ts";

// mdbmap's own aggregate over every user's personal rating for a unit. Derived
// on read, never stored, never merged with service ratings. No rows means no
// score (count 0, mean undefined) rather than a zero.
const communityScoreProvider: CommunityScoreProvider = {
	scoreFor: async (unit: RateableUnit, db: Db): Promise<CommunityScore> => {
		const rows = await db
			.select({ score: personalRating.score })
			.from(personalRating)
			.where(
				and(
					eq(personalRating.unitKind, unit.kind),
					eq(personalRating.unitKey, unit.key),
				),
			);

		const count = rows.length;
		if (count === 0) {
			return { count: 0, mean: undefined };
		}

		const total = rows.reduce((sum, row) => sum + row.score, 0);
		return { count, mean: total / count };
	},
};

export { communityScoreProvider };
