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

import {
	persistWatchOrder,
	regenerateReleaseOrder,
} from "./continuity/orders.ts";

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
const seedCrossGroupContinuity = async (
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

interface FranchiseSpokes {
	readonly anidb: string;
	readonly anilist: string;
	readonly mal: string;
	readonly tmdb: string;
}

interface FranchiseSegmentBase extends FranchiseSpokes {
	readonly group: string;
}

type FranchiseSegmentSpec =
	| (FranchiseSegmentBase & { readonly kind: "atomic" })
	| (FranchiseSegmentBase & {
			readonly episodes: number;
			readonly kind: "episodic";
	  });

interface FranchiseSpec {
	readonly segments: readonly FranchiseSegmentSpec[];
	readonly watch?: readonly number[];
}

interface SeededFranchise {
	readonly continuityId: string;
	readonly continuityRowId: number;
	readonly groupIds: readonly number[];
	readonly segmentIds: readonly number[];
}

const episodeCount = (segment: FranchiseSegmentSpec): number =>
	segment.kind === "atomic" ? 1 : segment.episodes;

const seedSpineTitle = async (
	db: Db,
	groupId: number,
	segment: FranchiseSegmentSpec,
	ordinal: number,
): Promise<number> => {
	const unitRows = await db.insert(contentUnits).values({}).returning().all();
	const unitId = one(unitRows).id;
	const anidbId = await insertTitle(
		db,
		groupId,
		"anidb",
		segment.anidb,
		ordinal,
	);
	const spokeIds = await Promise.all(
		Array.from({ length: episodeCount(segment) }, async (_ignored, offset) =>
			insertSpoke(db, anidbId, `s1e${offset + 1}`),
		),
	);
	const [firstSpoke] = spokeIds;
	if (firstSpoke !== undefined) {
		await coverUnit(db, firstSpoke, unitId);
	}
	await Promise.all([
		anchorTitle(db, groupId, "mal", segment.mal, ordinal, unitId),
		anchorTitle(db, groupId, "anilist", segment.anilist, ordinal, unitId),
		anchorTitle(db, groupId, "tmdb", segment.tmdb, ordinal, unitId),
	]);
	return anidbId;
};

const insertNamedGroups = async (
	db: Db,
	keys: readonly string[],
): Promise<{
	readonly groupByKey: ReadonlyMap<string, number>;
	readonly groupIds: readonly number[];
}> => {
	const rows = await Promise.all(
		keys.map(async (key) => ({ groupId: await insertGroup(db), key })),
	);
	return {
		groupByKey: new Map(rows.map((row) => [row.key, row.groupId])),
		groupIds: rows.map((row) => row.groupId),
	};
};

const persistFranchiseOrders = async (
	db: Db,
	continuityRowId: number,
	segmentIds: readonly number[],
	watch: readonly number[] | undefined,
): Promise<void> => {
	await regenerateReleaseOrder(db, continuityRowId);
	if (watch === undefined) {
		return;
	}
	await persistWatchOrder(db, {
		continuityId: continuityRowId,
		segmentIds: watch.flatMap((index) => {
			const segmentId = segmentIds[index];
			return segmentId === undefined ? [] : [segmentId];
		}),
	});
};

const seedFranchise = async (
	db: Db,
	spec: FranchiseSpec,
): Promise<SeededFranchise> => {
	const groupKeys = [...new Set(spec.segments.map((segment) => segment.group))];
	const { groupByKey, groupIds } = await insertNamedGroups(db, groupKeys);
	const titleIds = await Promise.all(
		spec.segments.map(async (segment, ordinal) => {
			const groupId = groupByKey.get(segment.group);
			return seedSpineTitle(
				db,
				one(groupId === undefined ? [] : [groupId]),
				segment,
				ordinal,
			);
		}),
	);
	const continuityRows = await db
		.insert(continuities)
		.values({ source: "t1-structure" })
		.returning()
		.all();
	const continuityRowId = one(continuityRows).id;
	const segmentValues = spec.segments.flatMap((segment, releaseOrdinal) => {
		const titleId = titleIds[releaseOrdinal];
		return titleId === undefined
			? []
			: [
					{
						continuityId: continuityRowId,
						kind: segment.kind,
						releaseOrdinal,
						titleId,
					},
				];
	});
	const segmentRows = await db
		.insert(continuitySegments)
		.values(segmentValues)
		.returning()
		.all();
	const segmentIds = segmentRows.map((row) => row.id);
	await persistFranchiseOrders(db, continuityRowId, segmentIds, spec.watch);
	return {
		continuityId: `continuity:${continuityRowId}`,
		continuityRowId,
		groupIds,
		segmentIds,
	};
};

const madeInAbyssSpec = [
	{
		anidb: "9001",
		anilist: "9001",
		episodes: 2,
		group: "series",
		kind: "episodic",
		mal: "9001",
		tmdb: "tv:9001",
	},
	{
		anidb: "9002",
		anilist: "9002",
		group: "film",
		kind: "atomic",
		mal: "9002",
		tmdb: "movie:9002",
	},
	{
		anidb: "9003",
		anilist: "9003",
		episodes: 2,
		group: "series",
		kind: "episodic",
		mal: "9003",
		tmdb: "tv:9003",
	},
] as const satisfies readonly FranchiseSegmentSpec[];

const madokaMagicaSpec = [
	{
		anidb: "9101",
		anilist: "9101",
		episodes: 2,
		group: "series",
		kind: "episodic",
		mal: "9101",
		tmdb: "tv:9101",
	},
	{
		anidb: "9102",
		anilist: "9102",
		group: "film",
		kind: "atomic",
		mal: "9102",
		tmdb: "movie:9102",
	},
] as const satisfies readonly FranchiseSegmentSpec[];

const monogatariSpec = [
	{
		anidb: "9201",
		anilist: "9201",
		episodes: 2,
		group: "bake",
		kind: "episodic",
		mal: "9201",
		tmdb: "tv:9201",
	},
	{
		anidb: "9202",
		anilist: "9202",
		episodes: 2,
		group: "nise",
		kind: "episodic",
		mal: "9202",
		tmdb: "tv:9202",
	},
	{
		anidb: "9203",
		anilist: "9203",
		group: "kizu",
		kind: "atomic",
		mal: "9203",
		tmdb: "movie:9203",
	},
] as const satisfies readonly FranchiseSegmentSpec[];

const seedMadeInAbyss = async (db: Db): Promise<SeededFranchise> =>
	seedFranchise(db, { segments: madeInAbyssSpec });

const seedMadokaMagica = async (db: Db): Promise<SeededFranchise> =>
	seedFranchise(db, { segments: madokaMagicaSpec });

const seedMonogatari = async (db: Db): Promise<SeededFranchise> =>
	seedFranchise(db, { segments: monogatariSpec, watch: [2, 0, 1] });

export {
	seedCrossGroupContinuity,
	seedMadokaMagica,
	seedMadeInAbyss,
	seedMonogatari,
	seedSpyXFamily,
	seedTmdbContinuity,
};
export type { SeededFranchise };
