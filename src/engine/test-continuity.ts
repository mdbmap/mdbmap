import type { Db } from "@/db";
import {
	contentUnits,
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
): Promise<number> =>
	one(
		await db
			.insert(serviceTitles)
			.values({ groupId, ordinal, service, serviceId })
			.returning()
			.all(),
	).id;

const insertSpoke = async (
	db: Db,
	titleId: number,
	locator: string,
): Promise<number> =>
	one(
		await db
			.insert(serviceInstalments)
			.values({ locator, locatorKind: "position", titleId })
			.returning()
			.all(),
	).id;

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
	await coverUnit(db, await insertSpoke(db, titleId, "s1e1"), unitId);
};

const seedSpyXFamily = async (
	db: Db,
): Promise<{ readonly continuityId: string }> => {
	const groupId = one(
		await db.insert(titleGroups).values({ source: "t1-structure" }).returning().all(),
	).id;
	const unitIds: string[] = [];

	for (const [index, cour] of cours.entries()) {
		const unitId = one(await db.insert(contentUnits).values({}).returning().all()).id;
		unitIds.push(unitId);

		const anidbId = await insertTitle(db, groupId, "anidb", cour.anidb, index);
		for (let episode = 1; episode <= cour.episodes; episode += 1) {
			const spokeId = await insertSpoke(db, anidbId, `s1e${episode}`);
			if (episode === 1) {
				await coverUnit(db, spokeId, unitId);
			}
		}
		await anchorTitle(db, groupId, "mal", cour.mal, index, unitId);
		await anchorTitle(db, groupId, "anilist", cour.anilist, index, unitId);
	}

	const tmdbId = await insertTitle(db, groupId, "tmdb", "tv:120089", 0);
	for (const [index, unitId] of unitIds.entries()) {
		await coverUnit(db, await insertSpoke(db, tmdbId, `s1e${index + 1}`), unitId);
	}

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
	const groupId = one(
		await db.insert(titleGroups).values({ source: "release" }).returning().all(),
	).id;
	const unitId = one(await db.insert(contentUnits).values({}).returning().all()).id;
	const titleId = await insertTitle(db, groupId, "tmdb", `${namespace}:${tmdbId}`, 0);
	for (const locator of locators) {
		await coverUnit(db, await insertSpoke(db, titleId, locator), unitId);
	}
	return { continuityId: `group:${groupId}` };
};

export { seedSpyXFamily, seedTmdbContinuity };
