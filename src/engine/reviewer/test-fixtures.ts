import { serviceTitles, titleGroups } from "@/db/engine-schema";
import type { freshDb } from "@/db/test-helpers";

import { one } from "@/db";

type TestDb = Awaited<ReturnType<typeof freshDb>>;

const ascendingPair = (left: number, right: number): readonly [number, number] =>
	left < right ? [left, right] : [right, left];

const seedTitle = async (db: TestDb, service: string, serviceId: string) => {
	const group = one(
		await db
			.insert(titleGroups)
			.values({ ladderComplete: false, source: "llm-research" })
			.returning()
			.all(),
	);
	return one(
		await db
			.insert(serviceTitles)
			.values({ groupId: group.id, service, serviceId })
			.returning()
			.all(),
	);
};

export { one } from "@/db";
export { ascendingPair, seedTitle };
export type { TestDb };
