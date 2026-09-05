import { one } from "@/db";
import { serviceTitles, titleGroups } from "@/db/engine-schema";
import type { freshDb } from "@/db/test-helpers";

type TestDb = Awaited<ReturnType<typeof freshDb>>;

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

export { ascendingPair, one } from "@/db";
export { seedTitle };
export type { TestDb };
