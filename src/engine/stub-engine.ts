import type { InstalmentLocator } from "@/db/schema";

import type {
	EngineRead,
	MediaKind,
	ResolveResult,
	Segment,
} from "./seam.ts";
import { metadataProviderFor } from "./seam.ts";

interface Cour {
	anidb: string;
	anilist: string;
	episodes: number;
	mal: string;
	tmdb: string;
}

const locatorsFor = (
	provider: string,
	titleId: string,
	count: number,
): InstalmentLocator[] => {
	const locators: InstalmentLocator[] = [];
	for (let position = 1; position <= count; position += 1) {
		locators.push(`${provider}:${titleId}#${position}`);
	}
	return locators;
};

const animeContinuity = (cours: readonly Cour[]): ResolveResult => {
	const mediaKind: MediaKind = "anime";
	const provider = metadataProviderFor(mediaKind);
	const segments: Segment[] = cours.map((cour) => ({
		instalments: locatorsFor(provider, cour.anidb, cour.episodes),
		members: {
			anidb: cour.anidb,
			anilist: cour.anilist,
			mal: cour.mal,
			tmdb: cour.tmdb,
		},
	}));
	return { mediaKind, segments };
};

// Spy × Family — direction-A sample. Real ids: one TMDB series (120089) plus the
// per-cour AniDB entries with their matching MAL and AniList ids.
const spyXFamily = animeContinuity([
	{
		anidb: "16947",
		anilist: "140960",
		episodes: 12,
		mal: "50265",
		tmdb: "120089",
	},
	{
		anidb: "17061",
		anilist: "142838",
		episodes: 13,
		mal: "50602",
		tmdb: "120089",
	},
	{
		anidb: "17784",
		anilist: "158927",
		episodes: 12,
		mal: "53887",
		tmdb: "120089",
	},
]);

const fixtures = new Map<string, ResolveResult>([
	["continuity:spy-x-family", spyXFamily],
]);

const stubEngine: EngineRead = {
	resolveContinuity(continuityId) {
		const result = fixtures.get(continuityId);
		if (result === undefined) {
			throw new Error(`engine: no fixture for continuity ${continuityId}`);
		}
		return result;
	},
};

export { stubEngine };
