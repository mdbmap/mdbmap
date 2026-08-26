import { and, eq, inArray } from "drizzle-orm";

import type { WatchStatus } from "@/db/schema";
import { episodeProgress, personalRating, watchStatus } from "@/db/schema";
import type { ResolveResult } from "@/engine";
import { metadataProviderFor } from "@/engine";
import { pub } from "@/orpc/base";
import type { Db } from "@/orpc/context";
import { instalmentsOf } from "@/orpc/instalments";
import type { Providers, WorkMetadata } from "@/orpc/providers";
import type {
	EpisodeView,
	PartView,
	RateableUnit,
	ViewerTracking,
	WorkView,
} from "@/orpc/schema";
import { WorkGetInput } from "@/orpc/schema";

interface ViewerState {
	personalByUnit: Map<string, number>;
	statusRow: { rewatchCount: number; status: WatchStatus | undefined } | undefined;
	watchedSet: Set<string>;
}

const unitId = (unit: RateableUnit) => `${unit.kind}:${unit.key}`;
const partKeyFor = (continuityId: string, index: number) =>
	`part:${continuityId}:${index}`;

const loadViewerState = async (
	db: Db,
	userId: string,
	locators: string[],
	continuityId: string,
): Promise<ViewerState> => {
	const watchedSet = new Set<string>();
	if (locators.length > 0) {
		const progress = await db
			.select({ locator: episodeProgress.instalmentLocator })
			.from(episodeProgress)
			.where(
				and(
					eq(episodeProgress.userId, userId),
					inArray(episodeProgress.instalmentLocator, locators),
				),
			)
			.all();
		for (const row of progress) {
			watchedSet.add(row.locator);
		}
	}

	const statusRow = await db
		.select()
		.from(watchStatus)
		.where(
			and(
				eq(watchStatus.userId, userId),
				eq(watchStatus.continuityKey, continuityId),
			),
		)
		.get();

	const personalByUnit = new Map<string, number>();
	const ratings = await db
		.select()
		.from(personalRating)
		.where(eq(personalRating.userId, userId))
		.all();
	for (const row of ratings) {
		personalByUnit.set(`${row.unitKind}:${row.unitKey}`, row.score);
	}

	return { personalByUnit, statusRow, watchedSet };
};

const buildParts = async (
	resolved: ResolveResult,
	meta: WorkMetadata,
	providers: Providers,
	db: Db,
	continuityId: string,
	viewer: ViewerState | undefined,
): Promise<PartView[]> =>
	Promise.all(
		resolved.segments.map(async (segment, index) => {
			const segMeta = meta.segments[index];
			const partUnit: RateableUnit = {
				key: partKeyFor(continuityId, index),
				kind: "part",
			};
			const episodes: EpisodeView[] = await Promise.all(
				segment.instalments.map(async (locator, position) => {
					const epMeta = segMeta?.episodes[position];
					const episodeUnit: RateableUnit = { key: locator, kind: "episode" };
					const communityScore = await providers.community.scoreFor(
						episodeUnit,
						db,
					);
					return {
						airDate: epMeta?.airDate,
						communityScore,
						instalmentLocator: locator,
						number: epMeta?.number ?? position + 1,
						personalRating: viewer?.personalByUnit.get(unitId(episodeUnit)),
						rateableUnit: episodeUnit,
						title: epMeta?.title ?? `Episode ${position + 1}`,
						watched: viewer?.watchedSet.has(locator) ?? false,
					};
				}),
			);
			const communityScore = await providers.community.scoreFor(partUnit, db);
			const ratings = await providers.serviceRatings.ratingsFor(
				partUnit,
				segment.members,
			);
			return {
				airedFrom: segMeta?.airedFrom,
				airedTo: segMeta?.airedTo,
				communityScore,
				episodeCount: segment.instalments.length,
				episodes,
				label: segMeta?.label ?? `Part ${index + 1}`,
				personalRating: viewer?.personalByUnit.get(unitId(partUnit)),
				rateableUnit: partUnit,
				serviceRatings: [...ratings],
				year: segMeta?.year,
			};
		}),
	);

const get = pub.input(WorkGetInput).handler(async ({ context, input }): Promise<WorkView> => {
	const { continuityId } = input;
	const resolved = await context.engine.resolveContinuity(continuityId);
	const meta = await context.providers.metadata[
		metadataProviderFor(resolved.mediaKind)
	].fetchWork(resolved);

	const { user } = context;
	let viewerState: ViewerState | undefined;
	if (user !== undefined) {
		viewerState = await loadViewerState(
			context.db,
			user.id,
			instalmentsOf(resolved),
			continuityId,
		);
	}

	let viewer: ViewerTracking | undefined;
	if (viewerState !== undefined) {
		const workUnit: RateableUnit = { key: continuityId, kind: "work" };
		viewer = {
			personalRating: viewerState.personalByUnit.get(unitId(workUnit)),
			rewatchCount: viewerState.statusRow?.rewatchCount ?? 0,
			status: viewerState.statusRow?.status,
			watched: [...viewerState.watchedSet],
		};
	}

	const parts = await buildParts(
		resolved,
		meta,
		context.providers,
		context.db,
		continuityId,
		viewerState,
	);

	return {
		cast: [...meta.cast],
		continuityId,
		header: {
			backdropRef: meta.backdropRef,
			coverRef: meta.coverRef,
			nativeTitle: meta.nativeTitle,
			span: meta.span,
			synopsis: meta.synopsis,
			title: meta.title,
		},
		ifYouLiked: [...meta.ifYouLiked],
		mediaKind: resolved.mediaKind,
		parts,
		staff: [...meta.staff],
		studios: [...meta.studios],
		viewer,
	};
});

const work = { get };

export { work };
