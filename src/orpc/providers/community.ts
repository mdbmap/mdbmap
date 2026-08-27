import { and, eq, inArray } from "drizzle-orm";

import { personalRating } from "@/db/schema";
import type { Db } from "@/orpc/context";
import type { CommunityScore, RateableUnit } from "@/orpc/schema";

import type { CommunityScoreProvider } from "./types.ts";

// mdbmap's own aggregate over every user's personal rating for a unit. Derived
// on read, never stored, never merged with service ratings. No rows means no
// score (count 0, mean undefined) rather than a zero.
const communityScoreProvider: CommunityScoreProvider = {
	scoreFor: async (
		unit: RateableUnit,
		db: Db,
		aliases: readonly RateableUnit[] = [],
	): Promise<CommunityScore> => {
		const keys = [...aliases.map((alias) => alias.key), unit.key];
		const rows = await db
			.select({
				score: personalRating.score,
				unitKey: personalRating.unitKey,
				userId: personalRating.userId,
			})
			.from(personalRating)
			.where(
				and(
					eq(personalRating.unitKind, unit.kind),
					inArray(personalRating.unitKey, keys),
				),
			);
		const canonicalRank = (unitKey: string): number =>
			unitKey === unit.key ? 1 : 0;
		const scoresByUser = new Map<string, number>();
		for (const row of rows.toSorted(
			(left, right) =>
				canonicalRank(left.unitKey) - canonicalRank(right.unitKey),
		)) {
			scoresByUser.set(row.userId, row.score);
		}
		const scores = [...scoresByUser.values()];

		const count = scores.length;
		if (count === 0) {
			return { count: 0, mean: undefined };
		}

		const total = scores.reduce((sum, score) => sum + score, 0);
		return { count, mean: total / count };
	},
};

export { communityScoreProvider };
