import type { MemberTitles, MetadataProvider as MetadataProviderKind, ResolveResult } from "@/engine";
import type { Credit, Similar } from "@/orpc/schema";

import type {
	EpisodeMetadata,
	MetadataProvider,
	MetadataRegistry,
	SegmentMetadata,
	WorkMetadata,
} from "./types.ts";

// STUB — replaced by #5 (TMDB) and #6 (AniDB). Returns fixture display metadata
// so work.get is complete before the real providers land; the shape is the
// contract those issues implement.

interface WorkHeaderFixture {
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

const spyXFamily: WorkHeaderFixture = {
	backdropRef: "anidb:16947/backdrop",
	cast: [
		{ name: "Takuya Eguchi", ref: "anidb:c-loid", role: "Loid Forger" },
		{ name: "Atsumi Tanezaki", ref: "anidb:c-anya", role: "Anya Forger" },
		{ name: "Saori Hayami", ref: "anidb:c-yor", role: "Yor Forger" },
	],
	coverRef: "anidb:16947/cover",
	ifYouLiked: [
		{ continuityId: "continuity:mob-psycho-100", coverRef: undefined, title: "Mob Psycho 100" },
		{ continuityId: "continuity:kaguya-sama", coverRef: undefined, title: "Kaguya-sama: Love Is War" },
	],
	labelPrefix: "Cour",
	nativeTitle: "SPY×FAMILY",
	staff: [
		{ name: "Kazuhiro Furuhashi", ref: "anidb:s-director", role: "Director" },
		{ name: "Tatsuya Endo", ref: "anidb:s-creator", role: "Original Creator" },
	],
	startYear: 2022,
	studios: ["Wit Studio", "CloverWorks"],
	synopsis:
		"A spy on an undercover mission builds a fake family, unaware his adopted daughter reads minds and his wife is an assassin.",
	title: "Spy × Family",
};

const fixtures = new Map<string, WorkHeaderFixture>([["16947", spyXFamily]]);

const genericFixture: WorkHeaderFixture = {
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

const buildWork = (
	resolved: ResolveResult,
	memberOf: (members: MemberTitles) => string | undefined,
): WorkMetadata => {
	const [first] = resolved.segments;
	const primaryId = first === undefined ? undefined : memberOf(first.members);
	const fixture =
		(primaryId === undefined ? undefined : fixtures.get(primaryId)) ??
		genericFixture;

	const segments: SegmentMetadata[] = resolved.segments.map((segment, index) => ({
		airedFrom: undefined,
		airedTo: undefined,
		episodes: episodesFor(segment.instalments.length),
		label: `${fixture.labelPrefix} ${index + 1}`,
		year: fixture.startYear + index,
	}));

	const lastYear = segments.at(-1)?.year ?? fixture.startYear;
	const span =
		segments.length <= 1
			? `${fixture.startYear}`
			: `${fixture.startYear}–${lastYear}`;

	return {
		backdropRef: fixture.backdropRef,
		cast: fixture.cast,
		coverRef: fixture.coverRef,
		ifYouLiked: fixture.ifYouLiked,
		nativeTitle: fixture.nativeTitle,
		segments,
		span,
		staff: fixture.staff,
		studios: fixture.studios,
		synopsis: fixture.synopsis,
		title: fixture.title,
	};
};

const anidbProvider: MetadataProvider = {
	fetchWork: (resolved) => buildWork(resolved, (members) => members.anidb),
};

const tmdbProvider: MetadataProvider = {
	fetchWork: (resolved) => buildWork(resolved, (members) => members.tmdb),
};

const metadataRegistry: MetadataRegistry = {
	anidb: anidbProvider,
	tmdb: tmdbProvider,
} satisfies Readonly<Record<MetadataProviderKind, MetadataProvider>>;

export { metadataRegistry };
