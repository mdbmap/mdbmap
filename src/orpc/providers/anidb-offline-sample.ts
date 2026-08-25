import type { ResolveResult } from "@/engine";
import type { Credit, Similar } from "@/orpc/schema";

import type { EpisodeMetadata, SegmentMetadata, WorkMetadata } from "./types.ts";

// Bundled sample metadata served when AniDB client credentials are absent (CI and
// pre-launch), so the anime work page still renders without a live AniDB call.
// Once ANIDB_CLIENT/ANIDB_CLIENT_VER are set the provider fetches for real.

interface SampleHeader {
	backdropRef: string | undefined;
	cast: readonly Credit[];
	coverRef: string | undefined;
	ifYouLiked: readonly Similar[];
	labelPrefix: string;
	nativeTitle: string | undefined;
	staff: readonly Credit[];
	startYear: number;
	studios: readonly string[];
	synopsis: string;
	title: string;
}

const spyXFamily: SampleHeader = {
	backdropRef: "anidb:16947/backdrop",
	cast: [
		{ name: "Takuya Eguchi", ref: "anidb:creator:201", role: "Loid Forger" },
		{ name: "Atsumi Tanezaki", ref: "anidb:creator:202", role: "Anya Forger" },
		{ name: "Saori Hayami", ref: "anidb:creator:203", role: "Yor Forger" },
	],
	coverRef: "anidb:16947/cover",
	ifYouLiked: [
		{ continuityId: "continuity:mob-psycho-100", coverRef: undefined, title: "Mob Psycho 100" },
		{ continuityId: "continuity:kaguya-sama", coverRef: undefined, title: "Kaguya-sama: Love Is War" },
	],
	labelPrefix: "Cour",
	nativeTitle: "SPY×FAMILY",
	staff: [
		{ name: "Kazuhiro Furuhashi", ref: "anidb:creator:1", role: "Director" },
		{ name: "Tatsuya Endo", ref: "anidb:creator:2", role: "Original Creator" },
	],
	startYear: 2022,
	studios: ["Wit Studio", "CloverWorks"],
	synopsis:
		"A spy on an undercover mission builds a fake family, unaware his adopted daughter reads minds and his wife is an assassin.",
	title: "Spy × Family",
};

const headers = new Map<string, SampleHeader>([["16947", spyXFamily]]);

const genericHeader: SampleHeader = {
	backdropRef: undefined,
	cast: [],
	coverRef: undefined,
	ifYouLiked: [],
	labelPrefix: "Part",
	nativeTitle: undefined,
	staff: [],
	startYear: 2000,
	studios: [],
	synopsis: "",
	title: "Untitled work",
};

const episodesFor = (count: number): EpisodeMetadata[] => {
	const episodes: EpisodeMetadata[] = [];
	for (let number = 1; number <= count; number += 1) {
		episodes.push({ airDate: undefined, number, title: `Episode ${number}` });
	}
	return episodes;
};

const offlineSample = (resolved: ResolveResult): WorkMetadata => {
	const [first] = resolved.segments;
	const primaryId = first?.members.anidb;
	const header = (primaryId === undefined ? undefined : headers.get(primaryId)) ?? genericHeader;

	const segments: SegmentMetadata[] = resolved.segments.map((segment, index) => ({
		airedFrom: undefined,
		airedTo: undefined,
		episodes: episodesFor(segment.instalments.length),
		label: `${header.labelPrefix} ${index + 1}`,
		year: header.startYear + index,
	}));

	const lastYear = segments.at(-1)?.year ?? header.startYear;
	const span =
		segments.length <= 1 ? `${header.startYear}` : `${header.startYear}–${lastYear}`;

	return {
		backdropRef: header.backdropRef,
		cast: header.cast,
		coverRef: header.coverRef,
		ifYouLiked: header.ifYouLiked,
		nativeTitle: header.nativeTitle,
		segments,
		span,
		staff: header.staff,
		studios: header.studios,
		synopsis: header.synopsis,
		title: header.title,
	};
};

export { offlineSample };
