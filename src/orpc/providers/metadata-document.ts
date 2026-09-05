import { z } from "zod";

import type { Credit } from "@/orpc/schema";

import { pickLocalized, pickTitle } from "./metadata-locale.ts";
import type {
	EpisodeMetadata,
	SegmentMetadata,
	WorkMetadata,
} from "./types.ts";

const creditSchema = z.object({
	name: z.string(),
	ref: z.string().optional(),
	role: z.string(),
});

const similarSchema = z.object({
	continuityId: z.string(),
	coverRef: z.string().optional(),
	title: z.string(),
});

const localizedTextSchema = z.object({
	locale: z.string(),
	synopsis: z.string().optional(),
	tagline: z.string().optional(),
	title: z.string().optional(),
});

const localizedTitleSchema = z.object({
	locale: z.string(),
	text: z.string(),
	type: z.string().optional(),
});

const episodeSchema = z.object({
	airDate: z.string().optional(),
	number: z.number(),
	title: z.string(),
	titles: z.array(localizedTitleSchema).optional(),
});

const coreSegmentSchema = z.object({
	label: z.string(),
	labelTitles: z.array(localizedTitleSchema).optional(),
	year: z.number().optional(),
});

const volatileSegmentSchema = z.object({
	airedFrom: z.string().optional(),
	airedTo: z.string().optional(),
	episodes: z.array(episodeSchema),
});

const coreSnapshotSchema = z.object({
	alternativeTitles: z.array(z.string()).optional(),
	backdropRef: z.string().optional(),
	cast: z.array(creditSchema),
	certifications: z.array(z.string()).optional(),
	coverRef: z.string().optional(),
	genres: z.array(z.string()),
	ifYouLiked: z.array(similarSchema),
	localized: z.array(localizedTextSchema),
	nativeTitle: z.string().optional(),
	networks: z.array(z.string()).optional(),
	originalLanguage: z.string().optional(),
	productionStatus: z.string().optional(),
	runtimeMinutes: z.number().optional(),
	segments: z.array(coreSegmentSchema),
	staff: z.array(creditSchema),
	studios: z.array(z.string()),
	synopsis: z.string(),
	tagline: z.string().optional(),
	title: z.string(),
	titles: z.array(localizedTitleSchema).optional(),
	version: z.number(),
});

const volatileSnapshotSchema = z.object({
	segments: z.array(volatileSegmentSchema),
	span: z.string(),
	version: z.number(),
});

type CoreSnapshot = z.infer<typeof coreSnapshotSchema>;
type VolatileSnapshot = z.infer<typeof volatileSnapshotSchema>;

interface Snapshots {
	core: CoreSnapshot;
	volatile: VolatileSnapshot;
}

const toCredit = (credit: CoreSnapshot["cast"][number]): Credit => ({
	name: credit.name,
	ref: credit.ref,
	role: credit.role,
});

const toEpisode = (
	episode: VolatileSnapshot["segments"][number]["episodes"][number],
	locale: string,
): EpisodeMetadata => ({
	airDate: episode.airDate,
	number: episode.number,
	title: pickTitle(episode.titles ?? [], locale, episode.title),
});

const projectText = (
	core: CoreSnapshot,
	locale: string,
): { synopsis: string; tagline: string | undefined; title: string } => {
	const fromTitles =
		core.titles === undefined || core.titles.length === 0
			? undefined
			: pickTitle(core.titles, locale, core.title);
	const localized = pickLocalized(core.localized, locale);
	return {
		synopsis: localized?.synopsis ?? core.synopsis,
		tagline: localized?.tagline ?? core.tagline,
		title: localized?.title ?? fromTitles ?? core.title,
	};
};

const assemble = (
	core: CoreSnapshot,
	volatile: VolatileSnapshot,
	locale: string,
): WorkMetadata => {
	const projected = projectText(core, locale);
	const segments: SegmentMetadata[] = core.segments.map(
		(coreSegment, index) => {
			const volatileSegment = volatile.segments[index];
			return {
				airedFrom: volatileSegment?.airedFrom,
				airedTo: volatileSegment?.airedTo,
				episodes: (volatileSegment?.episodes ?? []).map((episode) =>
					toEpisode(episode, locale),
				),
				label:
					coreSegment.labelTitles === undefined
						? coreSegment.label
						: pickTitle(coreSegment.labelTitles, locale, coreSegment.label),
				year: coreSegment.year,
			};
		},
	);
	return {
		backdropRef: core.backdropRef,
		cast: core.cast.map((credit) => toCredit(credit)),
		coverRef: core.coverRef,
		genres: [...core.genres],
		ifYouLiked: core.ifYouLiked.map((similar) => ({
			continuityId: similar.continuityId,
			coverRef: similar.coverRef,
			title: similar.title,
		})),
		nativeTitle: core.nativeTitle,
		productionStatus: core.productionStatus,
		runtimeMinutes: core.runtimeMinutes,
		segments,
		span: volatile.span,
		staff: core.staff.map((credit) => toCredit(credit)),
		studios: [...core.studios],
		synopsis: projected.synopsis,
		tagline: projected.tagline,
		title: projected.title,
	};
};

const parseSnapshot = <Schema extends z.ZodType>(
	json: string,
	schema: Schema,
): z.infer<Schema> | undefined => {
	try {
		const result = schema.safeParse(JSON.parse(json) as unknown);
		return result.success ? result.data : undefined;
	} catch {
		return undefined;
	}
};

export {
	assemble,
	coreSegmentSchema,
	coreSnapshotSchema,
	creditSchema,
	episodeSchema,
	parseSnapshot,
	similarSchema,
	volatileSegmentSchema,
	volatileSnapshotSchema,
};
export type { CoreSnapshot, Snapshots, VolatileSnapshot };
