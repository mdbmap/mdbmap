import { and, eq, inArray } from "drizzle-orm";

import type { Db as GatewayDb } from "@/db";
import {
	assertionSources,
	continuitySegments,
	instalmentAssertions,
	serviceCoverages,
	serviceInstalments,
	serviceTitles,
	titleAssertions,
	titleGroupAliases,
	titleGroups,
} from "@/db/engine-schema";
import type { AssertionConfidence, GroupSource } from "@/db/engine-schema";
import type { Identity, Service } from "@/engine/identity.ts";
import type {
	PathAssertion,
	ResolvedAnswer,
	ResolvedCounterpart,
	ResolvedInstalment,
	ResolvedLink,
	ResolvedLinks,
} from "@/engine/serializer.ts";

import {
	isIdentityService,
	memberInstalment,
	memberTitle,
	toGraphLocator,
	toGraphMember,
} from "./keys.ts";

type GraphRead =
	| { readonly found: false }
	| {
			readonly answer: ResolvedAnswer;
			readonly continuityId: number | undefined;
			readonly found: true;
			readonly pendingRef: string | undefined;
			readonly reviewRef: string | undefined;
	  };

type TitleRow = typeof serviceTitles.$inferSelect;
type InstalmentRow = typeof serviceInstalments.$inferSelect;
type InstalmentEdge = typeof instalmentAssertions.$inferSelect;

// A target service's standing across every coverage revision. A usable revision
// (complete or open) serves even while a newer build runs, so it outranks a
// pending or conflicting one (ADR-0001).
interface CoverageVerdict {
	readonly conflictId: number | undefined;
	readonly pendingId: number | undefined;
	readonly usable: boolean;
}

// Opaque handles collected while building links, surfaced only when no target is
// usable: a pending status URL token or a conflict review reference.
interface RefSink {
	pendingRef: string | undefined;
	reviewRef: string | undefined;
}

const groupContinuity = (groupId: number): string => `group:${groupId}`;

const opaqueRef = (prefix: string, id: number): string =>
	`${prefix}:${id.toString(36)}`;

const takeFirst = <Row>(rows: readonly Row[]): Row | undefined => rows[0];

const survivorGroupId = async (
	db: GatewayDb,
	groupId: number,
): Promise<number> => {
	const aliases = await db
		.select()
		.from(titleGroupAliases)
		.where(eq(titleGroupAliases.retiredGroupId, groupId))
		.all();
	return takeFirst(aliases)?.survivorGroupId ?? groupId;
};

const continuityIdForGroup = async (
	db: GatewayDb,
	groupId: number,
): Promise<number | undefined> => {
	const row = takeFirst(
		await db
			.select({ continuityId: continuitySegments.continuityId })
			.from(continuitySegments)
			.innerJoin(
				serviceTitles,
				eq(serviceTitles.id, continuitySegments.titleId),
			)
			.where(eq(serviceTitles.groupId, groupId))
			.orderBy(continuitySegments.continuityId)
			.all(),
	);
	return row?.continuityId;
};

const coverageVerdicts = async (
	db: GatewayDb,
	groupId: number,
): Promise<ReadonlyMap<string, CoverageVerdict>> => {
	const verdicts = new Map<string, CoverageVerdict>();
	const rows = await db
		.select()
		.from(serviceCoverages)
		.where(eq(serviceCoverages.baselineContinuity, groupContinuity(groupId)))
		.all();
	for (const row of rows) {
		const prior = verdicts.get(row.targetService);
		verdicts.set(row.targetService, {
			conflictId:
				prior?.conflictId ?? (row.state === "conflict" ? row.id : undefined),
			pendingId:
				prior?.pendingId ?? (row.state === "pending" ? row.id : undefined),
			usable:
				(prior?.usable ?? false) ||
				row.state === "complete" ||
				row.state === "open",
		});
	}
	return verdicts;
};

// Curation precedence (ADR-0002 §Provenance): manual outranks community down to
// the structural tiers; "release" is not curated and ranks below them all.
const sourceRank = (source: GroupSource): number =>
	source === "release" ? -1 : assertionSources.indexOf(source);

const mostCurated = (
	sources: Iterable<GroupSource>,
): GroupSource | undefined => {
	let best: GroupSource | undefined;
	for (const source of sources) {
		if (best === undefined || sourceRank(source) > sourceRank(best)) {
			best = source;
		}
	}
	return best;
};

// The assertion sources every matched counterpart in a link map carries — the
// provenance those linked positions speak with.
const linkSources = (links: ResolvedLinks): readonly GroupSource[] =>
	[...links.values()].flatMap((link) =>
		link.status === "matched"
			? link.counterparts.flatMap((counterpart) =>
					counterpart.assertionPath.map((assertion) => assertion.source),
				)
			: [],
	);

// Evidence backing one title counterpart. A direct title assertion is a one-step
// path; absent that, the group's own provenance stands in.
const titleEvidence = async (
	db: GatewayDb,
	source: GroupSource,
	fromId: number,
	toId: number,
): Promise<Pick<ResolvedCounterpart, "assertionPath" | "confidence">> => {
	const pair = and(
		eq(titleAssertions.titleAId, Math.min(fromId, toId)),
		eq(titleAssertions.titleBId, Math.max(fromId, toId)),
	);
	const direct = takeFirst(
		await db.select().from(titleAssertions).where(pair).all(),
	);
	if (direct !== undefined) {
		return {
			assertionPath: [{ confidence: direct.confidence, source: direct.source }],
			confidence: direct.confidence,
		};
	}
	if (source === "release") {
		return { assertionPath: [], confidence: "low" };
	}
	const path: readonly PathAssertion[] = [{ confidence: "low", source }];
	return { assertionPath: path, confidence: "low" };
};

const completionFor = (
	verdict: CoverageVerdict | undefined,
	refs: RefSink,
): ResolvedLink | undefined => {
	if (verdict === undefined) {
		return undefined;
	}
	if (verdict.usable) {
		return { status: "known-no-counterpart" };
	}
	if (verdict.pendingId !== undefined) {
		refs.pendingRef ??= opaqueRef("pending", verdict.pendingId);
		return { status: "pending" };
	}
	if (verdict.conflictId !== undefined) {
		refs.reviewRef ??= opaqueRef("review", verdict.conflictId);
		return { status: "conflict" };
	}
	return undefined;
};

// The content units a title's own spokes cover, each mapped to a spoke that
// covers it. Used to decide whether a title-level counterpart is coextensive
// with the requested title, and to name the request-side supporting spoke.
const titleUnitSpokes = async (
	db: GatewayDb,
	titleId: number,
): Promise<Map<string, InstalmentRow>> => {
	const spokes = await db
		.select()
		.from(serviceInstalments)
		.where(eq(serviceInstalments.titleId, titleId))
		.all();
	const byUnit = new Map<string, InstalmentRow>();
	if (spokes.length === 0) {
		return byUnit;
	}
	const spokeById = new Map(spokes.map((spoke) => [spoke.id, spoke]));
	const edges = await db
		.select()
		.from(instalmentAssertions)
		.where(inArray(instalmentAssertions.instalmentId, [...spokeById.keys()]))
		.all();
	for (const edge of edges) {
		const spoke = spokeById.get(edge.instalmentId);
		if (spoke !== undefined && !byUnit.has(edge.unitId)) {
			byUnit.set(edge.unitId, spoke);
		}
	}
	return byUnit;
};

interface CounterpartShape {
	readonly identity: Identity;
	readonly supportingInstalment?: Identity;
}

// Reconciles a title-level counterpart's coverage against the request so a bare
// title never overstates coverage (ADR-0001). A counterpart spanning units the
// request does not is named by its own instalment on a shared unit; a counterpart
// covering less keeps the bare title and names the request-side spoke; equal
// coverage stays a bare title.
const reconcileCounterpart = (
	requested: TitleRow,
	requestedUnits: ReadonlyMap<string, InstalmentRow>,
	member: { readonly service: Service; readonly serviceId: string },
	memberUnits: ReadonlyMap<string, InstalmentRow>,
	bare: Identity,
): CounterpartShape => {
	if (!isIdentityService(requested.service)) {
		return { identity: bare };
	}
	const sharedUnits = [...requestedUnits.keys()]
		.filter((unit) => memberUnits.has(unit))
		.toSorted();
	const [sharedUnit] = sharedUnits;
	const requestInsideMember =
		requestedUnits.size > 0 && sharedUnits.length === requestedUnits.size;
	const memberSpansMore = [...memberUnits.keys()].some(
		(unit) => !requestedUnits.has(unit),
	);
	if (requestInsideMember && memberSpansMore && sharedUnit !== undefined) {
		const spoke = memberUnits.get(sharedUnit);
		const instalment =
			spoke === undefined
				? undefined
				: memberInstalment(
						{ service: member.service, serviceId: member.serviceId },
						spoke.locator,
					);
		return { identity: instalment ?? bare };
	}
	if (requestInsideMember || sharedUnit === undefined) {
		return { identity: bare };
	}
	const spoke = requestedUnits.get(sharedUnit);
	const supporting =
		spoke === undefined
			? undefined
			: memberInstalment(
					{ service: requested.service, serviceId: requested.serviceId },
					spoke.locator,
				);
	return supporting === undefined
		? { identity: bare }
		: { identity: bare, supportingInstalment: supporting };
};

const titleCounterparts = async (
	db: GatewayDb,
	requested: TitleRow,
	members: readonly TitleRow[],
	source: GroupSource,
	service: Service,
	requestedUnits: ReadonlyMap<string, InstalmentRow>,
): Promise<readonly ResolvedCounterpart[]> => {
	const nested = await Promise.all(
		members
			.filter((member) => member.service === service)
			.map(async (member): Promise<ResolvedCounterpart[]> => {
				const bare = memberTitle({ service, serviceId: member.serviceId });
				if (bare === undefined) {
					return [];
				}
				const memberUnits = await titleUnitSpokes(db, member.id);
				const { identity, supportingInstalment } = reconcileCounterpart(
					requested,
					requestedUnits,
					{ service, serviceId: member.serviceId },
					memberUnits,
					bare,
				);
				const evidence = await titleEvidence(
					db,
					source,
					requested.id,
					member.id,
				);
				return [
					supportingInstalment === undefined
						? { identity, ...evidence }
						: { identity, supportingInstalment, ...evidence },
				];
			}),
	);
	return nested.flat();
};

const titleLinks = async (
	db: GatewayDb,
	requested: TitleRow,
	members: readonly TitleRow[],
	source: GroupSource,
	verdicts: ReadonlyMap<string, CoverageVerdict>,
): Promise<{ readonly links: ResolvedLinks; readonly refs: RefSink }> => {
	const links = new Map<Service, ResolvedLink>();
	const refs: RefSink = { pendingRef: undefined, reviewRef: undefined };
	const requestedUnits = await titleUnitSpokes(db, requested.id);
	const services = new Set<string>([
		...members.map((member) => member.service),
		...verdicts.keys(),
	]);
	const targets = [...services]
		.toSorted()
		.filter(
			(service): service is Service =>
				isIdentityService(service) && service !== requested.service,
		);
	const resolved = await Promise.all(
		targets.map(async (service) => ({
			counterparts: await titleCounterparts(
				db,
				requested,
				members,
				source,
				service,
				requestedUnits,
			),
			service,
		})),
	);
	for (const { counterparts, service } of resolved) {
		if (counterparts.length > 0) {
			links.set(service, { counterparts, status: "matched" });
			continue;
		}
		const completion = completionFor(verdicts.get(service), refs);
		if (completion !== undefined) {
			links.set(service, completion);
		}
	}
	return { links, refs };
};

const weakerGrade = (
	left: AssertionConfidence,
	right: AssertionConfidence,
): AssertionConfidence => (left === "low" || right === "low" ? "low" : "high");

// A derived instalment mapping follows two accepted assertions through the shared
// unit — the anchor's coverage and the counterpart's. Both ride the path, and the
// mapping is only as strong as its weaker edge (ADR-0001, ADR-0002).
const instalmentEvidence = (
	anchor: InstalmentEdge,
	counterpart: InstalmentEdge,
): Pick<ResolvedCounterpart, "assertionPath" | "confidence"> => ({
	assertionPath: [
		{ confidence: anchor.confidence, source: anchor.source },
		{ confidence: counterpart.confidence, source: counterpart.source },
	],
	confidence: weakerGrade(anchor.confidence, counterpart.confidence),
});

interface ServiceCounterpart {
	readonly counterpart: ResolvedCounterpart;
	readonly service: Service;
}

const resolveInstalmentCounterpart = async (
	db: GatewayDb,
	anchor: InstalmentEdge,
	edge: InstalmentEdge,
): Promise<ServiceCounterpart | undefined> => {
	const spoke = takeFirst(
		await db
			.select()
			.from(serviceInstalments)
			.where(eq(serviceInstalments.id, edge.instalmentId))
			.all(),
	);
	if (spoke === undefined) {
		return undefined;
	}
	const title = takeFirst(
		await db
			.select()
			.from(serviceTitles)
			.where(eq(serviceTitles.id, spoke.titleId))
			.all(),
	);
	if (title === undefined || !isIdentityService(title.service)) {
		return undefined;
	}
	const member = { service: title.service, serviceId: title.serviceId };
	const identity = memberInstalment(member, spoke.locator);
	if (identity === undefined) {
		return undefined;
	}
	return {
		counterpart: { identity, ...instalmentEvidence(anchor, edge) },
		service: title.service,
	};
};

const instalmentCounterparts = async (
	db: GatewayDb,
	anchorId: number,
): Promise<ReadonlyMap<Service, ResolvedCounterpart[]>> => {
	const counterparts = new Map<Service, ResolvedCounterpart[]>();
	const anchorEdges = await db
		.select()
		.from(instalmentAssertions)
		.where(eq(instalmentAssertions.instalmentId, anchorId))
		.all();
	const anchorByUnit = new Map(anchorEdges.map((row) => [row.unitId, row]));
	if (anchorByUnit.size === 0) {
		return counterparts;
	}
	const edges = await db
		.select()
		.from(instalmentAssertions)
		.where(inArray(instalmentAssertions.unitId, [...anchorByUnit.keys()]))
		.all();
	// A merged counterpart can share several units with the anchor; its spoke is one
	// counterpart on that content unit, so the first edge wins and later ones drop.
	const seen = new Set<number>();
	const pending: {
		readonly anchor: InstalmentEdge;
		readonly edge: InstalmentEdge;
	}[] = [];
	for (const edge of edges) {
		const anchor = anchorByUnit.get(edge.unitId);
		if (
			edge.instalmentId === anchorId ||
			anchor === undefined ||
			seen.has(edge.instalmentId)
		) {
			continue;
		}
		seen.add(edge.instalmentId);
		pending.push({ anchor, edge });
	}
	const resolved = await Promise.all(
		pending.map(async ({ anchor, edge }) =>
			resolveInstalmentCounterpart(db, anchor, edge),
		),
	);
	for (const entry of resolved) {
		if (entry === undefined) {
			continue;
		}
		const list = counterparts.get(entry.service) ?? [];
		list.push(entry.counterpart);
		counterparts.set(entry.service, list);
	}
	return counterparts;
};

// An instalment lookup answers per target service like a title lookup: a matched
// spoke where a counterpart instalment exists, otherwise the anchor title's group
// coverage decides pending/conflict/known-no-counterpart (ADR-0001).
const instalmentLinks = async (
	db: GatewayDb,
	anchorId: number,
	requestedService: string,
	verdicts: ReadonlyMap<string, CoverageVerdict>,
): Promise<{ readonly links: ResolvedLinks; readonly refs: RefSink }> => {
	const counterparts = await instalmentCounterparts(db, anchorId);
	const links = new Map<Service, ResolvedLink>();
	const refs: RefSink = { pendingRef: undefined, reviewRef: undefined };
	const services = new Set<string>([
		...counterparts.keys(),
		...verdicts.keys(),
	]);
	for (const service of [...services].toSorted()) {
		if (!isIdentityService(service) || service === requestedService) {
			continue;
		}
		const list = counterparts.get(service);
		if (list !== undefined && list.length > 0) {
			links.set(service, { counterparts: list, status: "matched" });
			continue;
		}
		const completion = completionFor(verdicts.get(service), refs);
		if (completion !== undefined) {
			links.set(service, completion);
		}
	}
	return { links, refs };
};

interface RequestedInstalment {
	readonly input: Identity;
	readonly links: ResolvedLinks;
}

// The requested title's own spokes, each resolved to its per-service counterparts
// in the request direction (ADR-0002). The serving source is decided by the caller,
// once the derived group source is known for the unlinked fallback.
const requestedInstalments = async (
	db: GatewayDb,
	requested: TitleRow,
	verdicts: ReadonlyMap<string, CoverageVerdict>,
): Promise<readonly RequestedInstalment[]> => {
	if (!isIdentityService(requested.service)) {
		return [];
	}
	const member = { service: requested.service, serviceId: requested.serviceId };
	const spokes = await db
		.select()
		.from(serviceInstalments)
		.where(eq(serviceInstalments.titleId, requested.id))
		.all();
	const nested = await Promise.all(
		spokes.map(async (spoke): Promise<RequestedInstalment[]> => {
			const input = memberInstalment(member, spoke.locator);
			if (input === undefined) {
				return [];
			}
			const { links } = await instalmentLinks(
				db,
				spoke.id,
				requested.service,
				verdicts,
			);
			return [{ input, links }];
		}),
	);
	return nested.flat();
};

const readTitle = async (
	db: GatewayDb,
	identity: Identity,
	requested: TitleRow,
): Promise<GraphRead> => {
	const groupId = await survivorGroupId(db, requested.groupId);
	const group = takeFirst(
		await db
			.select()
			.from(titleGroups)
			.where(eq(titleGroups.id, groupId))
			.all(),
	);
	const rowSource: GroupSource = group?.source ?? "release";
	const members = await db
		.select()
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, groupId))
		.orderBy(serviceTitles.ordinal, serviceTitles.id)
		.all();
	const verdicts = await coverageVerdicts(db, groupId);
	const { links, refs } = await titleLinks(
		db,
		requested,
		members,
		rowSource,
		verdicts,
	);
	const resolvedInstalments = await requestedInstalments(
		db,
		requested,
		verdicts,
	);
	// The served group source is the most curated across the group row and every one
	// of its links; each entry then carries its own, the group's when unlinked.
	const groupSource =
		mostCurated([
			rowSource,
			...linkSources(links),
			...resolvedInstalments.flatMap((entry) => linkSources(entry.links)),
		]) ?? rowSource;
	const instalments: readonly ResolvedInstalment[] = resolvedInstalments.map(
		(entry) => ({
			input: entry.input,
			links: entry.links,
			source: mostCurated(linkSources(entry.links)) ?? groupSource,
		}),
	);
	return {
		answer: { groupSource, input: identity, instalments, kind: "title", links },
		continuityId: await continuityIdForGroup(db, groupId),
		found: true,
		pendingRef: refs.pendingRef,
		reviewRef: refs.reviewRef,
	};
};

const readInstalment = async (
	db: GatewayDb,
	identity: Extract<Identity, { readonly kind: "instalment" }>,
	requested: TitleRow,
): Promise<GraphRead> => {
	const anchorMatch = and(
		eq(serviceInstalments.titleId, requested.id),
		eq(serviceInstalments.locator, toGraphLocator(identity.locator)),
	);
	const anchor = takeFirst(
		await db.select().from(serviceInstalments).where(anchorMatch).all(),
	);
	if (anchor === undefined) {
		return { found: false };
	}
	const groupId = await survivorGroupId(db, requested.groupId);
	const { links, refs } = await instalmentLinks(
		db,
		anchor.id,
		requested.service,
		await coverageVerdicts(db, groupId),
	);
	return {
		answer: { input: identity, kind: "instalment", links },
		continuityId: await continuityIdForGroup(db, groupId),
		found: true,
		pendingRef: refs.pendingRef,
		reviewRef: refs.reviewRef,
	};
};

const readGraph = async (
	db: GatewayDb,
	identity: Identity,
): Promise<GraphRead> => {
	const member = toGraphMember(identity.title);
	const match = and(
		eq(serviceTitles.service, member.service),
		eq(serviceTitles.serviceId, member.serviceId),
	);
	const requested = takeFirst(
		await db.select().from(serviceTitles).where(match).all(),
	);
	if (requested === undefined) {
		return { found: false };
	}
	return identity.kind === "instalment"
		? readInstalment(db, identity, requested)
		: readTitle(db, identity, requested);
};

export { readGraph, survivorGroupId };
export type { GraphRead };
