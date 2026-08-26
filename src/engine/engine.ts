import { eq, inArray } from "drizzle-orm";

import {
	instalmentAssertions,
	serviceInstalments,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import type { InstalmentLocator } from "@/db/schema";

import type { Db as GatewayDb } from "@/db";

import { toLocator } from "./gateway/keys.ts";
import { survivorGroupId } from "./gateway/read.ts";
import type {
	EngineRead,
	MediaKind,
	MemberTitles,
	ResolveResult,
	Segment,
} from "./seam.ts";
import { metadataProviderFor } from "./seam.ts";

// The EngineRead over the hub-and-spoke graph (ADR-0002). The continuity key names
// a title group; its ordered spine (the metadata provider's own titles) gives the
// segments, and every other service's member id aligns to a segment through the
// content units they share — no group/spoke/unit internal crosses the seam.

type TitleRow = typeof serviceTitles.$inferSelect;
type UnitId = string;

// Services the seam surfaces as members; other spokes in a group (imdb, tvdb,
// kitsu) resolve too but have no MemberTitles slot to carry them.
const memberServices = ["anidb", "anilist", "mal", "tmdb"] as const;
type MemberService = (typeof memberServices)[number];

const animeServices = new Set<string>(["anidb", "anilist", "kitsu", "mal"]);

const continuityPrefix = "group:";

const parseGroupId = (continuityId: string): number | undefined => {
	if (!continuityId.startsWith(continuityPrefix)) {
		return undefined;
	}
	const raw = continuityId.slice(continuityPrefix.length);
	const id = Number(raw);
	return raw !== "" && Number.isInteger(id) ? id : undefined;
};

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
	const tmdb = titles.find((title) => title.service === "tmdb");
	return tmdb?.serviceId.startsWith("movie:") === true ? "film" : "tv";
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
			candidates === undefined ? undefined : bestAligned(candidates, spineUnits);
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

const resolve = async (
	db: GatewayDb,
	continuityId: string,
): Promise<ResolveResult> => {
	const requested = parseGroupId(continuityId);
	if (requested === undefined) {
		throw new Error(`engine: malformed continuity ${continuityId}`);
	}
	const groupId = await survivorGroupId(db, requested);
	const group = await db
		.select()
		.from(titleGroups)
		.where(eq(titleGroups.id, groupId))
		.all();
	if (group.length === 0) {
		throw new Error(`engine: no continuity ${continuityId}`);
	}
	const titleRows = await db
		.select()
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, groupId))
		.all();
	const titles = titleRows.toSorted(compareTitles);
	const mediaKind = detectMediaKind(titles);
	const provider = metadataProviderFor(mediaKind);
	const spine = titles.filter((title) => title.service === provider);
	if (spine.length === 0) {
		throw new Error(`engine: continuity ${continuityId} has no ${provider} spine`);
	}
	const { byService, unitsByTitle } = await candidateGraph(db, titles);
	const segments: Segment[] = await Promise.all(
		spine.map(async (title): Promise<Segment> => ({
			instalments: await segmentLocators(db, provider, title),
			members: buildMembers(byService, unitsByTitle.get(title.id) ?? new Set()),
		})),
	);
	return { mediaKind, segments };
};

const createEngine = (db: GatewayDb): EngineRead => ({
	resolveContinuity: async (continuityId) => resolve(db, continuityId),
});

export { createEngine };
