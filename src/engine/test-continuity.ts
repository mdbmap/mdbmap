import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import {
	contentUnits,
	instalmentAssertions,
	serviceInstalments,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";

// Seeds Spy × Family as the engine stores it: one title group, per-cour AniDB /
// MAL / AniList spokes plus one TMDB spoke spanning every cour, each cour anchored
// to its own content unit so segment membership resolves through the hub. The real
// createEngine adapter reads exactly this to reproduce the retired stub's shape.

type SeedDb = BaseSQLiteDatabase<"sync", unknown, Record<string, unknown>>;

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

const insertTitle = (
	db: SeedDb,
	groupId: number,
	service: string,
	serviceId: string,
	ordinal: number,
): number =>
	one(
		db
			.insert(serviceTitles)
			.values({ groupId, ordinal, service, serviceId })
			.returning()
			.all(),
	).id;

const insertSpoke = (db: SeedDb, titleId: number, locator: string): number =>
	one(
		db
			.insert(serviceInstalments)
			.values({ locator, locatorKind: "position", titleId })
			.returning()
			.all(),
	).id;

const coverUnit = (db: SeedDb, instalmentId: number, unitId: number): void => {
	db.insert(instalmentAssertions)
		.values({ confidence: "high", instalmentId, source: "t3-episode", unitId })
		.run();
};

const anchorTitle = (
	db: SeedDb,
	groupId: number,
	service: string,
	serviceId: string,
	ordinal: number,
	unitId: number,
): void => {
	const titleId = insertTitle(db, groupId, service, serviceId, ordinal);
	coverUnit(db, insertSpoke(db, titleId, "s1e1"), unitId);
};

const seedSpyXFamily = (db: SeedDb): { readonly continuityId: string } => {
	const groupId = one(
		db.insert(titleGroups).values({ source: "t1-structure" }).returning().all(),
	).id;
	const unitIds: number[] = [];

	for (const [index, cour] of cours.entries()) {
		const unitId = one(db.insert(contentUnits).values({}).returning().all()).id;
		unitIds.push(unitId);

		const anidbId = insertTitle(db, groupId, "anidb", cour.anidb, index);
		for (let episode = 1; episode <= cour.episodes; episode += 1) {
			const spokeId = insertSpoke(db, anidbId, `s1e${episode}`);
			if (episode === 1) {
				coverUnit(db, spokeId, unitId);
			}
		}
		anchorTitle(db, groupId, "mal", cour.mal, index, unitId);
		anchorTitle(db, groupId, "anilist", cour.anilist, index, unitId);
	}

	const tmdbId = insertTitle(db, groupId, "tmdb", "tv:120089", 0);
	for (const [index, unitId] of unitIds.entries()) {
		coverUnit(db, insertSpoke(db, tmdbId, `s1e${index + 1}`), unitId);
	}

	return { continuityId: `group:${groupId}` };
};

// A minimal TMDB-only continuity: one namespaced spoke over one content unit, so
// the adapter's film/tv routing resolves from a real group.
const seedTmdbContinuity = (
	db: SeedDb,
	namespace: "movie" | "tv",
	tmdbId: string,
): { readonly continuityId: string } => {
	const groupId = one(
		db.insert(titleGroups).values({ source: "release" }).returning().all(),
	).id;
	const unitId = one(db.insert(contentUnits).values({}).returning().all()).id;
	const titleId = insertTitle(db, groupId, "tmdb", `${namespace}:${tmdbId}`, 0);
	coverUnit(db, insertSpoke(db, titleId, "s1e1"), unitId);
	return { continuityId: `group:${groupId}` };
};

export { seedSpyXFamily, seedTmdbContinuity };
