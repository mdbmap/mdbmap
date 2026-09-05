import { z } from "zod";

import type { Credit, Similar } from "@/orpc/schema";

import {
	coreSnapshotSchema,
	volatileSnapshotSchema,
} from "./metadata-document.ts";
import type { Snapshots } from "./metadata-document.ts";
import type { LocalizedText } from "./metadata-locale.ts";
import type { EpisodeMetadata } from "./types.ts";

const MAX_CAST = 30;
const MAX_GENRES = 8;
const MAX_SIMILAR = 12;
const YEAR_LENGTH = 4;

const STAFF_JOBS = new Map<string, string>([
	["Director", "Director"],
	["Series Composition", "Series Composition"],
	["Character Designer", "Character Design"],
	["Original Music Composer", "Music"],
	["Music", "Music"],
]);

const tmdbRoleSchema = z.object({ character: z.string().optional() });
const tmdbCastSchema = z.object({
	character: z.string().optional(),
	id: z.number(),
	name: z.string(),
	roles: z.array(tmdbRoleSchema).optional(),
});
const tmdbCrewSchema = z.object({
	id: z.number(),
	job: z.string().optional(),
	name: z.string(),
});
const tmdbCreditsSchema = z.object({
	cast: z.array(tmdbCastSchema).optional(),
	crew: z.array(tmdbCrewSchema).optional(),
});
const tmdbCreatorSchema = z.object({ id: z.number(), name: z.string() });
const tmdbCompanySchema = z.object({ name: z.string() });
const tmdbGenreSchema = z.object({ name: z.string() });
const tmdbRecommendationSchema = z.object({
	id: z.number(),
	name: z.string().optional(),
	poster_path: z.string().optional(),
	title: z.string().optional(),
});
const tmdbRecommendationsSchema = z.object({
	results: z.array(tmdbRecommendationSchema).optional(),
});
const tmdbSeasonSummarySchema = z.object({
	air_date: z.string().optional(),
	name: z.string().optional(),
	season_number: z.number(),
});
const tmdbTranslationDataSchema = z.object({
	name: z.string().optional(),
	overview: z.string().optional(),
	tagline: z.string().optional(),
	title: z.string().optional(),
});
const tmdbTranslationSchema = z.object({
	data: tmdbTranslationDataSchema.optional(),
	iso_639_1: z.string(),
});
const tmdbTranslationsSchema = z.object({
	translations: z.array(tmdbTranslationSchema).optional(),
});
const tmdbNetworkSchema = z.object({ name: z.string() });
const tmdbCountrySchema = z.object({ iso_3166_1: z.string().optional() });
const tmdbContentRatingSchema = z.object({
	iso_3166_1: z.string().optional(),
	rating: z.string().optional(),
});
const tmdbContentRatingsSchema = z.object({
	results: z.array(tmdbContentRatingSchema).optional(),
});
const tmdbReleaseDateSchema = z.object({
	certification: z.string().optional(),
	iso_3166_1: z.string().optional(),
});
const tmdbReleaseDateGroupSchema = z.object({
	iso_3166_1: z.string().optional(),
	release_dates: z.array(tmdbReleaseDateSchema).optional(),
});
const tmdbReleaseDatesSchema = z.object({
	results: z.array(tmdbReleaseDateGroupSchema).optional(),
});
const tmdbAlternativeTitleSchema = z.object({
	iso_3166_1: z.string().optional(),
	title: z.string(),
});
const tmdbAlternativeTitlesSchema = z.object({
	results: z.array(tmdbAlternativeTitleSchema).optional(),
	titles: z.array(tmdbAlternativeTitleSchema).optional(),
});

const tmdbSeriesSchema = z.object({
	aggregate_credits: tmdbCreditsSchema.optional(),
	alternative_titles: tmdbAlternativeTitlesSchema.optional(),
	backdrop_path: z.string().optional(),
	content_ratings: tmdbContentRatingsSchema.optional(),
	created_by: z.array(tmdbCreatorSchema).optional(),
	episode_run_time: z.array(z.number()).optional(),
	first_air_date: z.string().optional(),
	genres: z.array(tmdbGenreSchema).optional(),
	homepage: z.string().optional(),
	last_air_date: z.string().optional(),
	name: z.string().optional(),
	networks: z.array(tmdbNetworkSchema).optional(),
	origin_country: z.array(z.string()).optional(),
	original_language: z.string().optional(),
	original_name: z.string().optional(),
	overview: z.string().optional(),
	poster_path: z.string().optional(),
	production_companies: z.array(tmdbCompanySchema).optional(),
	production_countries: z.array(tmdbCountrySchema).optional(),
	recommendations: tmdbRecommendationsSchema.optional(),
	seasons: z.array(tmdbSeasonSummarySchema).optional(),
	status: z.string().optional(),
	tagline: z.string().optional(),
	translations: tmdbTranslationsSchema.optional(),
	type: z.string().optional(),
});

const tmdbMovieSchema = z.object({
	alternative_titles: tmdbAlternativeTitlesSchema.optional(),
	backdrop_path: z.string().optional(),
	credits: tmdbCreditsSchema.optional(),
	genres: z.array(tmdbGenreSchema).optional(),
	homepage: z.string().optional(),
	original_language: z.string().optional(),
	original_title: z.string().optional(),
	overview: z.string().optional(),
	poster_path: z.string().optional(),
	production_companies: z.array(tmdbCompanySchema).optional(),
	production_countries: z.array(tmdbCountrySchema).optional(),
	recommendations: tmdbRecommendationsSchema.optional(),
	release_date: z.string().optional(),
	release_dates: tmdbReleaseDatesSchema.optional(),
	runtime: z.number().optional(),
	status: z.string().optional(),
	tagline: z.string().optional(),
	title: z.string().optional(),
	translations: tmdbTranslationsSchema.optional(),
});

const tmdbEpisodeSchema = z.object({
	air_date: z.string().optional(),
	episode_number: z.number(),
	name: z.string().optional(),
	overview: z.string().optional(),
});
const tmdbSeasonSchema = z.object({
	air_date: z.string().optional(),
	episodes: z.array(tmdbEpisodeSchema).optional(),
});

type TmdbSeries = z.infer<typeof tmdbSeriesSchema>;
type TmdbMovie = z.infer<typeof tmdbMovieSchema>;
type TmdbSeason = z.infer<typeof tmdbSeasonSchema>;

const imageRef = (path: string | undefined): string | undefined =>
	path === undefined || path === "" ? undefined : `tmdb:${path}`;

const uniqueStrings = (names: readonly string[], limit: number): string[] => {
	const seen = new Set<string>();
	const values: string[] = [];
	for (const name of names) {
		const trimmed = name.trim();
		if (trimmed === "" || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		values.push(trimmed);
		if (values.length >= limit) {
			break;
		}
	}
	return values;
};

const uniqueGenres = (names: readonly string[]): string[] =>
	uniqueStrings(names, MAX_GENRES);

const genreNamesOf = (
	genres: readonly { name: string }[] | undefined,
): string[] => (genres ?? []).map((genre) => genre.name);

const positiveMinutes = (value: number | undefined): number | undefined =>
	value !== undefined && value > 0 ? value : undefined;

const trimmedStatus = (value: string | undefined): string | undefined => {
	if (value === undefined) {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
};

const yearOf = (date: string | undefined): number | undefined => {
	if (date === undefined) {
		return undefined;
	}
	const head = date.slice(0, YEAR_LENGTH);
	if (head.length < YEAR_LENGTH) {
		return undefined;
	}
	const year = Number(head);
	return Number.isNaN(year) ? undefined : year;
};

const normaliseCast = (series: TmdbSeries): Credit[] =>
	(series.aggregate_credits?.cast ?? []).slice(0, MAX_CAST).map((member) => ({
		name: member.name,
		ref: `tmdb:person:${member.id}`,
		role: member.roles?.[0]?.character ?? "",
	}));

const normaliseStaff = (series: TmdbSeries): Credit[] => {
	const staff: Credit[] = [];
	const seen = new Set<string>();
	const add = (name: string, ref: string, role: string) => {
		const dedupeKey = `${role}:${name}`;
		if (seen.has(dedupeKey)) {
			return;
		}
		seen.add(dedupeKey);
		staff.push({ name, ref, role });
	};
	for (const creator of series.created_by ?? []) {
		add(creator.name, `tmdb:person:${creator.id}`, "Original Creator");
	}
	for (const member of series.aggregate_credits?.crew ?? []) {
		const role =
			member.job === undefined ? undefined : STAFF_JOBS.get(member.job);
		if (role !== undefined) {
			add(member.name, `tmdb:person:${member.id}`, role);
		}
	}
	return staff;
};

const normaliseSimilar = (series: TmdbSeries): Similar[] =>
	(series.recommendations?.results ?? []).slice(0, MAX_SIMILAR).map((rec) => ({
		continuityId: `tmdb:tv:${rec.id}`,
		coverRef: imageRef(rec.poster_path),
		title: rec.name ?? "",
	}));

const normaliseMovieSimilar = (movie: TmdbMovie): Similar[] =>
	(movie.recommendations?.results ?? []).slice(0, MAX_SIMILAR).map((rec) => ({
		continuityId: `tmdb:movie:${rec.id}`,
		coverRef: imageRef(rec.poster_path),
		title: rec.title ?? rec.name ?? "",
	}));

const normaliseMovieCast = (movie: TmdbMovie): Credit[] =>
	(movie.credits?.cast ?? []).slice(0, MAX_CAST).map((member) => ({
		name: member.name,
		ref: `tmdb:person:${member.id}`,
		role: member.roles?.[0]?.character ?? member.character ?? "",
	}));

const normaliseMovieStaff = (movie: TmdbMovie): Credit[] => {
	const staff: Credit[] = [];
	const seen = new Set<string>();
	for (const member of movie.credits?.crew ?? []) {
		const role =
			member.job === undefined ? undefined : STAFF_JOBS.get(member.job);
		if (role === undefined) {
			continue;
		}
		const dedupeKey = `${role}:${member.name}`;
		if (seen.has(dedupeKey)) {
			continue;
		}
		seen.add(dedupeKey);
		staff.push({
			name: member.name,
			ref: `tmdb:person:${member.id}`,
			role,
		});
	}
	return staff;
};

const yearSpan = (from: number | undefined, to: number | undefined): string => {
	if (from === undefined) {
		return "";
	}
	if (to === undefined || to === from) {
		return `${from}`;
	}
	return `${from}–${to}`;
};

const spanOf = (series: TmdbSeries): string =>
	yearSpan(yearOf(series.first_air_date), yearOf(series.last_air_date));

const movieSpanOf = (movies: readonly TmdbMovie[]): string => {
	let from: number | undefined;
	let to: number | undefined;
	for (const movie of movies) {
		const year = yearOf(movie.release_date);
		if (year === undefined) {
			continue;
		}
		from = from === undefined ? year : Math.min(from, year);
		to = to === undefined ? year : Math.max(to, year);
	}
	return yearSpan(from, to);
};

const localizedOf = (
	translations: TmdbSeries["translations"],
	fallback: { synopsis: string; tagline: string | undefined; title: string },
): LocalizedText[] => {
	const rows: LocalizedText[] = [];
	const seen = new Set<string>();
	for (const translation of translations?.translations ?? []) {
		const { data } = translation;
		const title = data?.name ?? data?.title;
		const synopsis = data?.overview;
		const tagline = data?.tagline;
		if (
			(title === undefined || title === "") &&
			(synopsis === undefined || synopsis === "") &&
			(tagline === undefined || tagline === "")
		) {
			continue;
		}
		const locale = translation.iso_639_1.trim().toLowerCase();
		if (locale === "" || seen.has(locale)) {
			continue;
		}
		seen.add(locale);
		rows.push({ locale, synopsis, tagline, title });
	}
	if (!seen.has("en")) {
		rows.unshift({
			locale: "en",
			synopsis: fallback.synopsis,
			tagline: fallback.tagline,
			title: fallback.title,
		});
	}
	return rows;
};

const alternativeTitlesOf = (
	block: TmdbSeries["alternative_titles"],
): string[] =>
	uniqueStrings(
		[...(block?.results ?? []), ...(block?.titles ?? [])].map(
			(entry) => entry.title,
		),
		20,
	);

const certificationsOfSeries = (series: TmdbSeries): string[] =>
	uniqueStrings(
		(series.content_ratings?.results ?? [])
			.map((entry) => entry.rating ?? "")
			.filter((rating) => rating !== ""),
		8,
	);

const certificationsOfMovie = (movie: TmdbMovie): string[] =>
	uniqueStrings(
		(movie.release_dates?.results ?? []).flatMap((group) =>
			(group.release_dates ?? [])
				.map((entry) => entry.certification ?? "")
				.filter((certification) => certification !== ""),
		),
		8,
	);

interface SeasonSummary {
	label: string;
	year: number | undefined;
}

const volatileSegmentOf = (season: TmdbSeason) => {
	const episodes: EpisodeMetadata[] = (season.episodes ?? []).map(
		(episode) => ({
			airDate: episode.air_date,
			number: episode.episode_number,
			title: episode.name ?? `Episode ${episode.episode_number}`,
			titles: [
				{
					locale: "en",
					text: episode.name ?? `Episode ${episode.episode_number}`,
				},
			],
		}),
	);
	return {
		airedFrom: season.air_date ?? episodes[0]?.airDate,
		airedTo: episodes.at(-1)?.airDate,
		episodes,
	};
};

const regularSeasonsOf = (series: TmdbSeries) =>
	(series.seasons ?? [])
		.filter((season) => season.season_number >= 1)
		.toSorted((left, right) => left.season_number - right.season_number);

const buildSnapshots = (
	version: number,
	series: TmdbSeries,
	seasons: readonly TmdbSeason[],
	summaries: readonly SeasonSummary[],
): Snapshots => {
	const title = series.name ?? "";
	const nativeTitle =
		series.original_name !== undefined && series.original_name !== title
			? series.original_name
			: undefined;
	const tagline = trimmedStatus(series.tagline);
	const synopsis = series.overview ?? "";
	const core = coreSnapshotSchema.parse({
		alternativeTitles: alternativeTitlesOf(series.alternative_titles),
		backdropRef: imageRef(series.backdrop_path),
		cast: normaliseCast(series),
		certifications: certificationsOfSeries(series),
		coverRef: imageRef(series.poster_path),
		genres: uniqueGenres(genreNamesOf(series.genres)),
		ifYouLiked: normaliseSimilar(series),
		localized: localizedOf(series.translations, { synopsis, tagline, title }),
		nativeTitle,
		networks: (series.networks ?? []).map((network) => network.name),
		originalLanguage: series.original_language,
		productionStatus: trimmedStatus(series.status),
		runtimeMinutes: positiveMinutes(series.episode_run_time?.[0]),
		segments: summaries.map((summary) => ({
			label: summary.label,
			labelTitles: [{ locale: "en", text: summary.label }],
			year: summary.year,
		})),
		staff: normaliseStaff(series),
		studios: (series.production_companies ?? []).map((company) => company.name),
		synopsis,
		tagline,
		title,
		version,
	});
	const volatile = volatileSnapshotSchema.parse({
		segments: seasons.map((season) => volatileSegmentOf(season)),
		span: spanOf(series),
		version,
	});
	return { core, volatile };
};

const buildMovieSnapshots = (version: number, movie: TmdbMovie): Snapshots => {
	const title = movie.title ?? "";
	const nativeTitle =
		movie.original_title !== undefined && movie.original_title !== title
			? movie.original_title
			: undefined;
	const tagline = trimmedStatus(movie.tagline);
	const synopsis = movie.overview ?? "";
	const core = coreSnapshotSchema.parse({
		alternativeTitles: alternativeTitlesOf(movie.alternative_titles),
		backdropRef: imageRef(movie.backdrop_path),
		cast: normaliseMovieCast(movie),
		certifications: certificationsOfMovie(movie),
		coverRef: imageRef(movie.poster_path),
		genres: uniqueGenres(genreNamesOf(movie.genres)),
		ifYouLiked: normaliseMovieSimilar(movie),
		localized: localizedOf(movie.translations, { synopsis, tagline, title }),
		nativeTitle,
		networks: [],
		originalLanguage: movie.original_language,
		productionStatus: trimmedStatus(movie.status),
		runtimeMinutes: positiveMinutes(movie.runtime),
		segments: [
			{
				label: movie.title ?? "",
				labelTitles: [{ locale: "en", text: movie.title ?? "" }],
				year: yearOf(movie.release_date),
			},
		],
		staff: normaliseMovieStaff(movie),
		studios: (movie.production_companies ?? []).map((company) => company.name),
		synopsis,
		tagline,
		title,
		version,
	});
	const volatile = volatileSnapshotSchema.parse({
		segments: [
			{
				airedFrom: movie.release_date,
				airedTo: movie.release_date,
				episodes: [],
			},
		],
		span: movieSpanOf([movie]),
		version,
	});
	return { core, volatile };
};

const TV_APPEND =
	"aggregate_credits,recommendations,translations,alternative_titles,content_ratings,external_ids";
const MOVIE_APPEND =
	"credits,recommendations,translations,alternative_titles,release_dates,external_ids";

export {
	MOVIE_APPEND,
	TV_APPEND,
	buildMovieSnapshots,
	buildSnapshots,
	regularSeasonsOf,
	tmdbMovieSchema,
	tmdbSeasonSchema,
	tmdbSeriesSchema,
	yearOf,
};
export type { SeasonSummary, TmdbMovie, TmdbSeason, TmdbSeries };
