import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";

import {
	continuitySegments,
	presentationOrderProposalItems,
	presentationOrderProposals,
} from "@/db/engine-schema";
import type { WatchStatus } from "@/db/schema";
import { episodeProgress, personalRating, watchStatus } from "@/db/schema";
import type { EngineRead, ResolveResult, Segment } from "@/engine";
import { metadataProviderFor } from "@/engine";
import { parseContinuityKey } from "@/engine/continuity/keys";
import { isMissingContinuity } from "@/engine/continuity/missing";
import {
	reorderByIds,
	selectPresentationOrder,
} from "@/engine/continuity/orders";
import { retiredContinuityKeys } from "@/engine/continuity/persist";
import { pub } from "@/orpc/base";
import { catalogueLinks } from "@/orpc/catalogue-links";
import type { Db } from "@/orpc/context";
import { instalmentsOf } from "@/orpc/instalments";
import { fetchDisplayMetadata } from "@/orpc/providers";
import type { Providers, WorkMetadata } from "@/orpc/providers";
import type {
	CommunityOrderRef,
	EpisodeView,
	FilmView,
	PartView,
	ProposalSegmentRef,
	RateableUnit,
	ViewerTracking,
	WorkBlock,
	WorkView,
} from "@/orpc/schema";
import { WorkGetInput } from "@/orpc/schema";
import { resolveSimilar } from "@/orpc/similar";

import { open } from "./work-open";

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

const buildEpisodes = async (
	segment: Segment,
	segMeta: WorkMetadata["segments"][number] | undefined,
	providers: Providers,
	db: Db,
	viewer: ViewerState | undefined,
): Promise<EpisodeView[]> =>
	Promise.all(
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

const buildPartBlock = async (
	segment: Segment,
	index: number,
	segMeta: WorkMetadata["segments"][number] | undefined,
	providers: Providers,
	db: Db,
	continuityId: string,
	aliasKeys: readonly string[],
	viewer: ViewerState | undefined,
): Promise<PartView> => {
	const partUnit: RateableUnit = {
		key: partKeyFor(continuityId, index),
		kind: "part",
	};
	const aliases = aliasKeys.map((key) => ({
		key: partKeyFor(key, index),
		kind: "part" as const,
	}));
	const [episodes, communityScore, ratings] = await Promise.all([
		buildEpisodes(segment, segMeta, providers, db, viewer),
		providers.community.scoreFor(partUnit, db, aliases),
		providers.serviceRatings.ratingsFor(partUnit, segment.members),
	]);
	return {
		airedFrom: segMeta?.airedFrom,
		airedTo: segMeta?.airedTo,
		communityScore,
		episodeCount: segment.instalments.length,
		episodes,
		kind: "part",
		label: segMeta?.label ?? `Part ${index + 1}`,
		personalRating: viewer?.personalByUnit.get(unitId(partUnit)),
		rateableUnit: partUnit,
		serviceRatings: [...ratings],
		year: segMeta?.year,
	};
};

const buildFilmBlock = async (
	segment: Segment,
	segMeta: WorkMetadata["segments"][number] | undefined,
	providers: Providers,
	db: Db,
	viewer: ViewerState | undefined,
): Promise<FilmView> => {
	const [locator] = segment.instalments;
	if (locator === undefined) {
		throw new Error("engine: atomic segment has no instalment");
	}
	const movieUnit = { key: locator, kind: "movie" } as const;
	const airDate = segMeta?.airedFrom ?? segMeta?.episodes[0]?.airDate;
	const [communityScore, ratings] = await Promise.all([
		providers.community.scoreFor(movieUnit, db),
		providers.serviceRatings.ratingsFor(movieUnit, segment.members),
	]);
	return {
		airDate,
		airedFrom: airDate,
		airedTo: airDate,
		communityScore,
		episodeCount: 0,
		episodes: [],
		instalmentLocator: locator,
		kind: "film",
		label: segMeta?.label ?? "Film",
		personalRating: viewer?.personalByUnit.get(unitId(movieUnit)),
		rateableUnit: movieUnit,
		serviceRatings: [...ratings],
		watched: viewer?.watchedSet.has(locator) ?? false,
		year: segMeta?.year,
	};
};

const buildBlocks = async (
	resolved: ResolveResult,
	meta: WorkMetadata,
	providers: Providers,
	db: Db,
	continuityId: string,
	aliasKeys: readonly string[],
	viewer: ViewerState | undefined,
): Promise<WorkBlock[]> =>
	Promise.all(
		resolved.segments.map(async (segment, index) => {
			const segMeta = meta.segments[index];
			if (segment.kind === "atomic") {
				return buildFilmBlock(segment, segMeta, providers, db, viewer);
			}
			return buildPartBlock(
				segment,
				index,
				segMeta,
				providers,
				db,
				continuityId,
				aliasKeys,
				viewer,
			);
		}),
	);

const resolveMappedWork = async (
	engine: EngineRead,
	requestedId: string,
): Promise<ResolveResult> => {
	try {
		return await engine.resolveContinuity(requestedId);
	} catch (error) {
		if (isMissingContinuity(error)) {
			throw new ORPCError("NOT_FOUND", { message: error.message });
		}
		throw error;
	}
};

const loadAcceptedCommunityOrders = async (
	db: Db,
	continuityId: number,
): Promise<CommunityOrderRef[]> =>
	db
		.select({
			id: presentationOrderProposals.id,
			name: presentationOrderProposals.name,
		})
		.from(presentationOrderProposals)
		.where(
			and(
				eq(presentationOrderProposals.continuityId, continuityId),
				eq(presentationOrderProposals.status, "accepted"),
			),
		)
		.orderBy(asc(presentationOrderProposals.id))
		.all();

const loadReleaseSegmentIds = async (
	db: Db,
	continuityId: number,
): Promise<number[]> => {
	const rows = await db
		.select({ id: continuitySegments.id })
		.from(continuitySegments)
		.where(eq(continuitySegments.continuityId, continuityId))
		.orderBy(asc(continuitySegments.releaseOrdinal))
		.all();
	return rows.map((row) => row.id);
};

const loadAcceptedProposalSegmentIds = async (
	db: Db,
	continuityId: number,
	proposalId: number,
): Promise<number[]> => {
	const proposal = await db
		.select({
			continuityId: presentationOrderProposals.continuityId,
			status: presentationOrderProposals.status,
		})
		.from(presentationOrderProposals)
		.where(eq(presentationOrderProposals.id, proposalId))
		.get();
	if (
		proposal === undefined ||
		proposal.continuityId !== continuityId ||
		proposal.status !== "accepted"
	) {
		throw new ORPCError("NOT_FOUND", {
			message: "Accepted proposal not found for continuity.",
		});
	}
	const items = await db
		.select({ segmentId: presentationOrderProposalItems.segmentId })
		.from(presentationOrderProposalItems)
		.where(eq(presentationOrderProposalItems.proposalId, proposalId))
		.orderBy(asc(presentationOrderProposalItems.position))
		.all();
	return items.map((item) => item.segmentId);
};

const proposalSegmentsFor = (
	releaseSegmentIds: readonly number[],
	built: readonly WorkBlock[],
): ProposalSegmentRef[] =>
	releaseSegmentIds.map((id, index) => ({
		id,
		label: built[index]?.label ?? `Part ${String(index + 1)}`,
	}));

const get = pub
	.input(WorkGetInput)
	.handler(async ({ context, input }): Promise<WorkView> => {
		const requestedId = input.continuityId;
		const resolved = await resolveMappedWork(context.engine, requestedId);
		const { continuityId } = resolved;
		const meta = await fetchDisplayMetadata(context.providers, resolved);

		const parsedCanonical = parseContinuityKey(continuityId);
		const aliasKeys = [
			...new Set([
				...(parsedCanonical === undefined
					? []
					: await retiredContinuityKeys(context.db, parsedCanonical)),
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

		const workUnit: RateableUnit = { key: continuityId, kind: "work" };
		const workAliases = aliasKeys.map((key) => ({
			key,
			kind: "work" as const,
		}));

		let viewer: ViewerTracking | undefined;
		if (viewerState !== undefined) {
			viewer = {
				personalRating: viewerState.personalByUnit.get(unitId(workUnit)),
				rewatchCount: viewerState.statusRow?.rewatchCount ?? 0,
				status: viewerState.statusRow?.status,
				watched: [...viewerState.watchedSet],
			};
		}

		const [built, communityScore] = await Promise.all([
			buildBlocks(
				resolved,
				meta,
				context.providers,
				context.db,
				continuityId,
				aliasKeys,
				viewerState,
			),
			context.providers.community.scoreFor(workUnit, context.db, workAliases),
		]);
		const communityOrders =
			parsedCanonical === undefined
				? []
				: await loadAcceptedCommunityOrders(context.db, parsedCanonical);
		const releaseSegmentIds =
			parsedCanonical === undefined
				? []
				: await loadReleaseSegmentIds(context.db, parsedCanonical);
		const proposalSegments = proposalSegmentsFor(releaseSegmentIds, built);

		let ordered = built;
		if (parsedCanonical !== undefined) {
			if (input.proposalId === undefined) {
				const selected = await selectPresentationOrder(
					context.db,
					parsedCanonical,
					input.order,
				);
				ordered = reorderByIds(
					built,
					selected.releaseSegmentIds,
					selected.segmentIds,
				);
			} else {
				const proposalSegmentIds = await loadAcceptedProposalSegmentIds(
					context.db,
					parsedCanonical,
					input.proposalId,
				);
				if (
					proposalSegmentIds.length !== releaseSegmentIds.length ||
					new Set(proposalSegmentIds).size !== releaseSegmentIds.length ||
					proposalSegmentIds.some(
						(segmentId) => !releaseSegmentIds.includes(segmentId),
					)
				) {
					throw new ORPCError("BAD_REQUEST", {
						message:
							"Accepted proposal must include each continuity segment exactly once.",
					});
				}
				ordered = reorderByIds(built, releaseSegmentIds, proposalSegmentIds);
			}
		}
		const parts = ordered.length > 0 ? ordered : built;

		const ifYouLiked = await resolveSimilar(context.db, meta.ifYouLiked, {
			excludeContinuityId: continuityId,
		});

		return {
			cast: [...meta.cast],
			catalogues: catalogueLinks(
				resolved.segments,
				meta.segments.map((segment) => segment.label),
			),
			communityOrders,
			communityScore,
			continuityId,
			header: {
				backdropRef: meta.backdropRef,
				coverRef: meta.coverRef,
				genres: [...meta.genres],
				nativeTitle: meta.nativeTitle,
				productionStatus: meta.productionStatus,
				runtimeMinutes: meta.runtimeMinutes,
				span: meta.span,
				synopsis: meta.synopsis,
				title: meta.title,
			},
			ifYouLiked: [...ifYouLiked],
			mediaKind: resolved.mediaKind,
			parts,
			proposalSegments,
			staff: [...meta.staff],
			studios: [...meta.studios],
			viewer,
		};
	});

const work = { get, open };

export { work };
