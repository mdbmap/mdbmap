import { asc, eq, inArray } from "drizzle-orm";

import type { Db as GatewayDb } from "@/db";
import {
	continuities,
	continuitySegments,
	instalmentAssertions,
	serviceInstalments,
	serviceTitles,
} from "@/db/engine-schema";
import type { InstalmentLocator } from "@/db/schema";

import { continuityKey, parseContinuityKey } from "./continuity/keys.ts";
import { survivorContinuityId } from "./continuity/persist.ts";
import { toLocator } from "./gateway/keys.ts";
import type {
	EngineRead,
	MediaKind,
	MemberTitles,
	ResolveResult,
	Segment,
} from "./seam.ts";

type TitleRow = typeof serviceTitles.$inferSelect;
type UnitId = string;

// Services the seam surfaces as members; other spokes in a group (tvdb, kitsu)
// resolve too but have no MemberTitles slot to carry them. IMDb feeds both the
// IMDb user rating and Metacritic critic score (ADR-0007).
const memberServices = ["anidb", "anilist", "imdb", "mal", "tmdb"] as const;
type MemberService = (typeof memberServices)[number];

const animeServices = new Set<string>(["anidb", "anilist", "kitsu", "mal"]);

// TMDB spokes fold their movie/tv namespace into the stored id (keys.ts); the
// seam publishes the bare numeric id the metadata provider expects.
const memberId = (title: TitleRow): string =>
	title.service === "tmdb"
		? (title.serviceId.split(":")[1] ?? title.serviceId)
		: title.serviceId;

const isMemberService = (service: string): service is MemberService =>
	memberServices.some((candidate) => candidate === service);

// Anime when the group carries an anime-catalogue spoke; otherwise the TMDB
// namespace tells film from tv (the routing metadataProviderFor encodes).
const detectMediaKind = (titles: readonly TitleRow[]): MediaKind => {
	if (titles.some((title) => animeServices.has(title.service))) {
		return "anime";
	}
	return titles.some(
		(title) => title.service === "tmdb" && title.serviceId.startsWith("tv:"),
	)
		? "tv"
		: "film";
};

const compareTitles = (left: TitleRow, right: TitleRow): number =>
	left.ordinal - right.ordinal || left.id - right.id;

// The content units a title's spokes cover — the hub side of the assertion graph
// (ADR-0002). Segment membership is decided by which titles share these units.
const unitsCovered = async (
	db: GatewayDb,
	titleId: number,
): Promise<ReadonlySet<UnitId>> => {
	const spokes = await db
		.select({ id: serviceInstalments.id })
		.from(serviceInstalments)
		.where(eq(serviceInstalments.titleId, titleId))
		.all();
	if (spokes.length === 0) {
		return new Set();
	}
	const edges = await db
		.select({ unitId: instalmentAssertions.unitId })
		.from(instalmentAssertions)
		.where(
			inArray(
				instalmentAssertions.instalmentId,
				spokes.map((spoke) => spoke.id),
			),
		)
		.all();
	return new Set(edges.map((edge) => edge.unitId));
};

const countShared = (
	left: ReadonlySet<UnitId>,
	right: ReadonlySet<UnitId>,
): number => {
	let shared = 0;
	for (const unit of left) {
		if (right.has(unit)) {
			shared += 1;
		}
	}
	return shared;
};

interface Candidate {
	readonly title: TitleRow;
	readonly units: ReadonlySet<UnitId>;
}

// The candidate sharing the most content units with the segment's spine; ties go
// to the earlier candidate, so pre-sorting by ordinal keeps the pick stable.
const bestAligned = (
	candidates: readonly Candidate[],
	spineUnits: ReadonlySet<UnitId>,
): TitleRow | undefined => {
	let best: { readonly shared: number; readonly title: TitleRow } | undefined;
	for (const candidate of candidates) {
		const shared = countShared(candidate.units, spineUnits);
		if (shared > 0 && (best === undefined || shared > best.shared)) {
			best = { shared, title: candidate.title };
		}
	}
	return best?.title;
};

const buildMembers = (
	byService: ReadonlyMap<MemberService, readonly Candidate[]>,
	spineUnits: ReadonlySet<UnitId>,
): MemberTitles => {
	const members: MemberTitles = {};
	for (const service of memberServices) {
		const candidates = byService.get(service);
		const aligned =
			candidates === undefined
				? undefined
				: bestAligned(candidates, spineUnits);
		if (aligned !== undefined) {
			members[service] = memberId(aligned);
		}
	}
	return members;
};

interface CandidateGraph {
	readonly byService: ReadonlyMap<MemberService, readonly Candidate[]>;
	readonly unitsByTitle: ReadonlyMap<number, ReadonlySet<UnitId>>;
}

const candidateGraph = async (
	db: GatewayDb,
	titles: readonly TitleRow[],
): Promise<CandidateGraph> => {
	const members = titles.filter(
		(title): title is TitleRow & { service: MemberService } =>
			isMemberService(title.service),
	);
	const covered = await Promise.all(
		members.map(async (title) => ({
			title,
			units: await unitsCovered(db, title.id),
		})),
	);
	const byService = new Map<MemberService, Candidate[]>();
	const unitsByTitle = new Map<number, ReadonlySet<UnitId>>();
	for (const { title, units } of covered) {
		unitsByTitle.set(title.id, units);
		const list = byService.get(title.service) ?? [];
		list.push({ title, units });
		byService.set(title.service, list);
	}
	return { byService, unitsByTitle };
};

// Only main-sequence spokes are trackable episodes; season-0 specials persist as
// spokes too (ADR-0002) and stay out of the positional locator stream.
const segmentLocators = async (
	db: GatewayDb,
	provider: string,
	spine: TitleRow,
): Promise<InstalmentLocator[]> => {
	const spokes = await db
		.select({ locator: serviceInstalments.locator })
		.from(serviceInstalments)
		.where(eq(serviceInstalments.titleId, spine.id))
		.all();
	const episodes = spokes.filter((spoke) => {
		const locator = toLocator(spoke.locator);
		return locator !== undefined && locator.season >= 1;
	}).length;
	const id = memberId(spine);
	const locators: InstalmentLocator[] = [];
	for (let position = 1; position <= episodes; position += 1) {
		locators.push(`${provider}:${id}#${position}`);
	}
	return locators;
};

const membersForSegment = (
	graph: CandidateGraph,
	title: TitleRow,
): MemberTitles => {
	const members = buildMembers(
		graph.byService,
		graph.unitsByTitle.get(title.id) ?? new Set(),
	);
	if (isMemberService(title.service)) {
		members[title.service] = memberId(title);
	}
	return members;
};

const resolve = async (
	db: GatewayDb,
	requestedKey: string,
): Promise<ResolveResult> => {
	const parsed = parseContinuityKey(requestedKey);
	if (parsed === undefined) {
		throw new Error(`engine: malformed continuity ${requestedKey}`);
	}
	const continuityId = await survivorContinuityId(db, parsed);
	const continuity = await db
		.select({ id: continuities.id })
		.from(continuities)
		.where(eq(continuities.id, continuityId))
		.get();
	if (continuity === undefined) {
		throw new Error(`engine: no continuity ${requestedKey}`);
	}
	const persistedSegments = await db
		.select()
		.from(continuitySegments)
		.where(eq(continuitySegments.continuityId, continuityId))
		.orderBy(asc(continuitySegments.releaseOrdinal))
		.all();
	if (persistedSegments.length === 0) {
		throw new Error(`engine: continuity ${requestedKey} has no segments`);
	}
	const segmentTitles = await db
		.select()
		.from(serviceTitles)
		.where(
			inArray(
				serviceTitles.id,
				persistedSegments.map((segment) => segment.titleId),
			),
		)
		.all();
	const segmentTitleById = new Map(
		segmentTitles.map((title) => [title.id, title]),
	);
	const groupIds = [...new Set(segmentTitles.map((title) => title.groupId))];
	const titleRows = await db
		.select()
		.from(serviceTitles)
		.where(inArray(serviceTitles.groupId, groupIds))
		.all();
	const titles = titleRows.toSorted(compareTitles);
	const mediaKind = detectMediaKind(titles);
	const graphByGroup = new Map(
		await Promise.all(
			groupIds.map(async (groupId) => {
				const groupTitles = titles.filter((title) => title.groupId === groupId);
				return [groupId, await candidateGraph(db, groupTitles)] as const;
			}),
		),
	);
	const segments: Segment[] = await Promise.all(
		persistedSegments.map(async (segment): Promise<Segment> => {
			const title = segmentTitleById.get(segment.titleId);
			if (title === undefined) {
				throw new Error(
					`engine: continuity ${requestedKey} has a missing segment`,
				);
			}
			const graph = graphByGroup.get(title.groupId);
			if (graph === undefined) {
				throw new Error(
					`engine: continuity ${requestedKey} has no graph for group ${title.groupId}`,
				);
			}
			const segmentProvider = title.service;
			return {
				instalments:
					segment.kind === "atomic"
						? [`${segmentProvider}:${memberId(title)}#1`]
						: await segmentLocators(db, segmentProvider, title),
				kind: segment.kind,
				members: membersForSegment(graph, title),
			};
		}),
	);
	return { continuityId: continuityKey(continuityId), mediaKind, segments };
};

const createEngine = (db: GatewayDb): EngineRead => ({
	resolveContinuity: async (continuityId) => resolve(db, continuityId),
});

export { createEngine };
