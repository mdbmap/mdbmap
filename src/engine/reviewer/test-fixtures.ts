import { serviceTitles, titleGroups } from "@/db/engine-schema";
import type { freshDb } from "@/db/test-helpers";

type TestDb = Awaited<ReturnType<typeof freshDb>>;

const one = <Row>(rows: readonly Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected an inserted row");
	}
	return row;
};

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

export { ascendingPair, one, seedTitle };
export type { TestDb };
