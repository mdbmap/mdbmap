import { and, eq, inArray } from "drizzle-orm";

import type { WatchStatus } from "@/db/schema";
import { episodeProgress, personalRating, watchStatus } from "@/db/schema";
import type { ResolveResult } from "@/engine";
import { metadataProviderFor } from "@/engine";
import { parseContinuityKey } from "@/engine/continuity/keys";
import {
	reorderByIds,
	selectPresentationOrder,
} from "@/engine/continuity/orders";
import { trackingAliasKeys } from "@/engine/continuity/persist";
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
	statusRow:
		| { rewatchCount: number; status: WatchStatus | undefined }
		| undefined;
	watchedSet: Set<string>;
}

const unitId = (unit: RateableUnit) => `${unit.kind}:${unit.key}`;
const partKeyFor = (continuityId: string, index: number) =>
	`part:${continuityId}:${index}`;

const keyOwnsContinuity = (unitKey: string, continuityKey: string): boolean =>
	unitKey === continuityKey || unitKey.startsWith(`part:${continuityKey}:`);

const rewriteContinuityToken = (
	unitKey: string,
	from: string,
	to: string,
): string => {
	if (unitKey === from) {
		return to;
	}
	const prefix = `part:${from}:`;
	if (unitKey.startsWith(prefix)) {
		return `part:${to}:${unitKey.slice(prefix.length)}`;
	}
	return unitKey;
};

const loadViewerState = async (
	db: Db,
	userId: string,
	locators: string[],
	canonicalId: string,
	requestedId: string,
	aliasKeys: readonly string[],
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

	const continuityKeys = [...new Set([canonicalId, requestedId, ...aliasKeys])];

	const statusRows = await db
		.select()
		.from(watchStatus)
		.where(
			and(
				eq(watchStatus.userId, userId),
				inArray(watchStatus.continuityKey, continuityKeys),
			),
		)
		.all();
	const statusRow =
		statusRows.find((row) => row.continuityKey === canonicalId) ??
		statusRows.find((row) => row.continuityKey === requestedId) ??
		statusRows.find((row) =>
			aliasKeys.some((key) => key === row.continuityKey),
		);

	const personalByUnit = new Map<string, number>();
	const ratings = await db
		.select()
		.from(personalRating)
		.where(eq(personalRating.userId, userId))
		.all();
	const canonicalRank = (unitKey: string): number =>
		keyOwnsContinuity(unitKey, canonicalId) ? 1 : 0;
	const rewriteUnitKey = (unitKey: string): string => {
		let next = unitKey;
		for (const from of aliasKeys) {
			next = rewriteContinuityToken(next, from, canonicalId);
		}
		return rewriteContinuityToken(next, requestedId, canonicalId);
	};
	for (const row of ratings.toSorted(
		(left, right) => canonicalRank(left.unitKey) - canonicalRank(right.unitKey),
	)) {
		const canonicalUnitKey =
			row.unitKind === "work" || row.unitKind === "part"
				? rewriteUnitKey(row.unitKey)
				: row.unitKey;
		personalByUnit.set(`${row.unitKind}:${canonicalUnitKey}`, row.score);
	}

	return { personalByUnit, statusRow, watchedSet };
};

const buildParts = async (
	resolved: ResolveResult,
	meta: WorkMetadata,
	providers: Providers,
	db: Db,
	continuityId: string,
	aliasKeys: readonly string[],
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
			const aliases = aliasKeys.map((key) => ({
				key: partKeyFor(key, index),
				kind: "part" as const,
			}));
			const communityScore = await providers.community.scoreFor(
				partUnit,
				db,
				aliases,
			);
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

const get = pub
	.input(WorkGetInput)
	.handler(async ({ context, input }): Promise<WorkView> => {
		const requestedId = input.continuityId;
		const resolved = await context.engine.resolveContinuity(requestedId);
		const { continuityId } = resolved;
		const meta =
			await context.providers.metadata[
				metadataProviderFor(resolved.mediaKind)
			].fetchWork(resolved);

		const parsedCanonical = parseContinuityKey(continuityId);
		const aliasKeys = [
			...new Set([
				...(parsedCanonical?.type === "continuity"
					? await trackingAliasKeys(context.db, parsedCanonical.id)
					: []),
				...(requestedId === continuityId ? [] : [requestedId]),
			]),
		].filter((key) => key !== continuityId);

		const { user } = context;
		let viewerState: ViewerState | undefined;
		if (user !== undefined) {
			viewerState = await loadViewerState(
				context.db,
				user.id,
				instalmentsOf(resolved),
				continuityId,
				requestedId,
				aliasKeys,
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

		const built = await buildParts(
			resolved,
			meta,
			context.providers,
			context.db,
			continuityId,
			aliasKeys,
			viewerState,
		);
		const selected =
			parsedCanonical?.type === "continuity"
				? await selectPresentationOrder(
						context.db,
						parsedCanonical.id,
						input.order,
					)
				: undefined;
		const ordered =
			selected === undefined
				? built
				: reorderByIds(built, selected.releaseSegmentIds, selected.segmentIds);
		const parts = ordered.length > 0 ? ordered : built;

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
