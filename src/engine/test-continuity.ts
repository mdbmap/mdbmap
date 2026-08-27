import type { Db } from "@/db";
import {
	contentUnits,
	continuities,
	continuitySegments,
	instalmentAssertions,
	serviceInstalments,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";

// Seeds Spy × Family as the engine stores it: one title group, per-cour AniDB /
// MAL / AniList spokes plus one TMDB spoke spanning every cour, each cour anchored
// to its own content unit so segment membership resolves through the hub.

interface CourSeed {
	readonly anidb: string;
	readonly anilist: string;
	readonly episodes: number;
	readonly mal: string;
}

const cours: readonly CourSeed[] = [
	{ anidb: "16947", anilist: "140960", episodes: 12, mal: "50265" },
	{ anidb: "17061", anilist: "142838", episodes: 13, mal: "50602" },
	{ anidb: "17784", anilist: "158927", episodes: 12, mal: "53887" },
];

const one = <Row>(rows: Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("test-continuity: expected an inserted row");
	}
	return row;
};

const insertTitle = async (
	db: Db,
	groupId: number,
	service: string,
	serviceId: string,
	ordinal: number,
): Promise<number> => {
	const rows = await db
		.insert(serviceTitles)
		.values({ groupId, ordinal, service, serviceId })
		.returning()
		.all();
	return one(rows).id;
};

const insertSpoke = async (
	db: Db,
	titleId: number,
	locator: string,
): Promise<number> => {
	const rows = await db
		.insert(serviceInstalments)
		.values({ locator, locatorKind: "position", titleId })
		.returning()
		.all();
	return one(rows).id;
};

const coverUnit = async (
	db: Db,
	instalmentId: number,
	unitId: string,
): Promise<void> => {
	await db
		.insert(instalmentAssertions)
		.values({ confidence: "high", instalmentId, source: "t3-episode", unitId })
		.run();
};

const anchorTitle = async (
	db: Db,
	groupId: number,
	service: string,
	serviceId: string,
	ordinal: number,
	unitId: string,
): Promise<void> => {
	const titleId = await insertTitle(db, groupId, service, serviceId, ordinal);
	const spokeId = await insertSpoke(db, titleId, "s1e1");
	await coverUnit(db, spokeId, unitId);
};

const seedCour = async (
	db: Db,
	groupId: number,
	cour: CourSeed,
	index: number,
): Promise<string> => {
	const unitRows = await db.insert(contentUnits).values({}).returning().all();
	const unitId = one(unitRows).id;
	const anidbId = await insertTitle(db, groupId, "anidb", cour.anidb, index);
	const episodeNumbers = Array.from(
		{ length: cour.episodes },
		(_ignored, offset) => offset + 1,
	);
	const spokeIds = await Promise.all(
		episodeNumbers.map(async (episode) =>
			insertSpoke(db, anidbId, `s1e${episode}`),
		),
	);
	const [firstSpoke] = spokeIds;
	if (firstSpoke !== undefined) {
		await coverUnit(db, firstSpoke, unitId);
	}
	await Promise.all([
		anchorTitle(db, groupId, "mal", cour.mal, index, unitId),
		anchorTitle(db, groupId, "anilist", cour.anilist, index, unitId),
	]);
	return unitId;
};

const seedSpyXFamily = async (
	db: Db,
): Promise<{ readonly continuityId: string }> => {
	const groupRows = await db
		.insert(titleGroups)
		.values({ source: "t1-structure" })
		.returning()
		.all();
	const groupId = one(groupRows).id;
	const unitIds = await Promise.all(
		cours.map(async (cour, index) => seedCour(db, groupId, cour, index)),
	);
	const tmdbId = await insertTitle(db, groupId, "tmdb", "tv:120089", 0);
	await Promise.all(
		unitIds.map(async (unitId, index) => {
			const spokeId = await insertSpoke(db, tmdbId, `s1e${index + 1}`);
			await coverUnit(db, spokeId, unitId);
		}),
	);
	return { continuityId: `group:${groupId}` };
};

// A minimal TMDB-only continuity: one namespaced spoke over one content unit, so
// the adapter's film/tv routing resolves from a real group.
const seedTmdbContinuity = async (
	db: Db,
	namespace: "movie" | "tv",
	tmdbId: string,
	locators: readonly string[] = ["s1e1"],
): Promise<{ readonly continuityId: string }> => {
	const groupRows = await db
		.insert(titleGroups)
		.values({ source: "release" })
		.returning()
		.all();
	const groupId = one(groupRows).id;
	const unitRows = await db.insert(contentUnits).values({}).returning().all();
	const unitId = one(unitRows).id;
	const titleId = await insertTitle(
		db,
		groupId,
		"tmdb",
		`${namespace}:${tmdbId}`,
		0,
	);
	await Promise.all(
		locators.map(async (locator) => {
			const spokeId = await insertSpoke(db, titleId, locator);
			await coverUnit(db, spokeId, unitId);
		}),
	);
	return { continuityId: `group:${groupId}` };
};

const insertGroup = async (db: Db): Promise<number> => {
	const groupRows = await db
		.insert(titleGroups)
		.values({ source: "t1-structure" })
		.returning()
		.all();
	return one(groupRows).id;
};

// Two title groups, one continuity. The series cour stays episodic; the film is
// an atomic segment on its own AniDB title. No title assertion joins the groups.
const seedCrossGroupFranchise = async (
	db: Db,
): Promise<{
	readonly continuityId: string;
	readonly filmGroupId: number;
	readonly seriesGroupId: number;
}> => {
	const seriesGroupId = await insertGroup(db);
	const filmGroupId = await insertGroup(db);
	const seriesUnitRows = await db
		.insert(contentUnits)
		.values({})
		.returning()
		.all();
	const filmUnitRows = await db
		.insert(contentUnits)
		.values({})
		.returning()
		.all();
	const seriesUnitId = one(seriesUnitRows).id;
	const filmUnitId = one(filmUnitRows).id;
	const seriesAnidbId = await insertTitle(
		db,
		seriesGroupId,
		"anidb",
		"1001",
		0,
	);
	const filmAnidbId = await insertTitle(db, filmGroupId, "anidb", "1002", 0);
	await insertSpoke(db, seriesAnidbId, "s0e1");
	const seriesMain = await insertSpoke(db, seriesAnidbId, "s1e1");
	await insertSpoke(db, seriesAnidbId, "s1e2");
	const filmSpokeId = await insertSpoke(db, filmAnidbId, "s1e1");
	await Promise.all([
		coverUnit(db, seriesMain, seriesUnitId),
		coverUnit(db, filmSpokeId, filmUnitId),
		anchorTitle(db, seriesGroupId, "mal", "2001", 0, seriesUnitId),
		anchorTitle(db, seriesGroupId, "tmdb", "tv:3001", 0, seriesUnitId),
		anchorTitle(db, filmGroupId, "mal", "2002", 0, filmUnitId),
		anchorTitle(db, filmGroupId, "tmdb", "movie:3002", 0, filmUnitId),
	]);
	const continuityRows = await db
		.insert(continuities)
		.values({ source: "t1-structure" })
		.returning()
		.all();
	const continuityRowId = one(continuityRows).id;
	await db
		.insert(continuitySegments)
		.values([
			{
				continuityId: continuityRowId,
				kind: "episodic",
				releaseOrdinal: 0,
				titleId: seriesAnidbId,
			},
			{
				continuityId: continuityRowId,
				kind: "atomic",
				releaseOrdinal: 1,
				titleId: filmAnidbId,
			},
		])
		.run();
	return {
		continuityId: `continuity:${continuityRowId}`,
		filmGroupId,
		seriesGroupId,
	};
};

export { seedCrossGroupFranchise, seedSpyXFamily, seedTmdbContinuity };
