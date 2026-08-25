import { and, eq, inArray } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";

import {
	instalmentAssertions,
	serviceCoverages,
	serviceInstalments,
	serviceTitles,
	titleAssertions,
	titleGroupAliases,
	titleGroups,
} from "@/db/engine-schema";
import type { GroupSource } from "@/db/engine-schema";

import type { Identity, Service } from "@/engine/identity.ts";
import type {
	PathAssertion,
	ResolvedAnswer,
	ResolvedCounterpart,
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

// Accepts both the schema-typed production db and a schemaless in-memory db.
type GatewayDb = BaseSQLiteDatabase<"sync", unknown, Record<string, unknown>>;

type GraphRead =
	| { readonly found: false }
	| {
			readonly answer: ResolvedAnswer;
			readonly found: true;
			readonly pendingRef: string | undefined;
			readonly reviewRef: string | undefined;
	  };

type TitleRow = typeof serviceTitles.$inferSelect;
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

const opaqueRef = (prefix: string, id: number): string => `${prefix}:${id.toString(36)}`;

const takeFirst = <Row>(rows: readonly Row[]): Row | undefined => rows[0];

const survivorGroupId = (db: GatewayDb, groupId: number): number => {
	const aliases = db
		.select()
		.from(titleGroupAliases)
		.where(eq(titleGroupAliases.retiredGroupId, groupId))
		.all();
	return takeFirst(aliases)?.survivorGroupId ?? groupId;
};

const coverageVerdicts = (
	db: GatewayDb,
	groupId: number,
): ReadonlyMap<string, CoverageVerdict> => {
	const verdicts = new Map<string, CoverageVerdict>();
	const rows = db
		.select()
		.from(serviceCoverages)
		.where(eq(serviceCoverages.baselineContinuity, groupContinuity(groupId)))
		.all();
	for (const row of rows) {
		const prior = verdicts.get(row.targetService);
		verdicts.set(row.targetService, {
			conflictId: prior?.conflictId ?? (row.state === "conflict" ? row.id : undefined),
			pendingId: prior?.pendingId ?? (row.state === "pending" ? row.id : undefined),
			usable: (prior?.usable ?? false) || row.state === "complete" || row.state === "open",
		});
	}
	return verdicts;
};

// Evidence backing one title counterpart. A direct title assertion is a one-step
// path; absent that, the group's own provenance stands in until the ladder
// matcher supplies the full derivation.
const titleEvidence = (
	db: GatewayDb,
	source: GroupSource,
	fromId: number,
	toId: number,
): Pick<ResolvedCounterpart, "assertionPath" | "confidence"> => {
	const pair = and(
		eq(titleAssertions.titleAId, Math.min(fromId, toId)),
		eq(titleAssertions.titleBId, Math.max(fromId, toId)),
	);
	const direct = takeFirst(db.select().from(titleAssertions).where(pair).all());
	if (direct !== undefined) {
		return {
			assertionPath: [{ confidence: direct.confidence, source: direct.source }],
			confidence: direct.confidence,
		};
	}
	if (source === "release") {
		return { assertionPath: [], confidence: "low" };
	}
	const path: readonly PathAssertion[] = [{ confidence: "high", source }];
	return { assertionPath: path, confidence: "high" };
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

const titleCounterparts = (
	db: GatewayDb,
	requested: TitleRow,
	members: readonly TitleRow[],
	source: GroupSource,
	service: Service,
): readonly ResolvedCounterpart[] =>
	members
		.filter((member) => member.service === service)
		.flatMap((member): ResolvedCounterpart[] => {
			const identity = memberTitle({ service, serviceId: member.serviceId });
			return identity === undefined
				? []
				: [{ identity, ...titleEvidence(db, source, requested.id, member.id) }];
		});

const titleLinks = (
	db: GatewayDb,
	requested: TitleRow,
	members: readonly TitleRow[],
	source: GroupSource,
	verdicts: ReadonlyMap<string, CoverageVerdict>,
): { readonly links: ResolvedLinks; readonly refs: RefSink } => {
	const links = new Map<Service, ResolvedLink>();
	const refs: RefSink = { pendingRef: undefined, reviewRef: undefined };
	const services = new Set<string>([
		...members.map((member) => member.service),
		...verdicts.keys(),
	]);
	for (const service of [...services].toSorted()) {
		if (!isIdentityService(service) || service === requested.service) {
			continue;
		}
		const counterparts = titleCounterparts(db, requested, members, source, service);
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

const readTitle = (db: GatewayDb, identity: Identity, requested: TitleRow): GraphRead => {
	const groupId = survivorGroupId(db, requested.groupId);
	const group = takeFirst(db.select().from(titleGroups).where(eq(titleGroups.id, groupId)).all());
	const source: GroupSource = group?.source ?? "release";
	const members = db
		.select()
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, groupId))
		.all();
	const { links, refs } = titleLinks(db, requested, members, source, coverageVerdicts(db, groupId));
	return {
		answer: { groupSource: source, input: identity, instalments: [], kind: "title", links },
		found: true,
		pendingRef: refs.pendingRef,
		reviewRef: refs.reviewRef,
	};
};

const instalmentEvidence = (
	edge: InstalmentEdge,
): Pick<ResolvedCounterpart, "assertionPath" | "confidence"> => ({
	assertionPath: [{ confidence: edge.confidence, source: edge.source }],
	confidence: edge.confidence,
});

const addInstalmentCounterpart = (
	db: GatewayDb,
	counterparts: Map<Service, ResolvedCounterpart[]>,
	edge: InstalmentEdge,
): void => {
	const spoke = takeFirst(
		db.select().from(serviceInstalments).where(eq(serviceInstalments.id, edge.instalmentId)).all(),
	);
	if (spoke === undefined) {
		return;
	}
	const title = takeFirst(
		db.select().from(serviceTitles).where(eq(serviceTitles.id, spoke.titleId)).all(),
	);
	if (title === undefined || !isIdentityService(title.service)) {
		return;
	}
	const member = { service: title.service, serviceId: title.serviceId };
	const identity = memberInstalment(member, spoke.locator);
	if (identity === undefined) {
		return;
	}
	const list = counterparts.get(title.service) ?? [];
	list.push({ identity, ...instalmentEvidence(edge) });
	counterparts.set(title.service, list);
};

const instalmentLinks = (db: GatewayDb, anchorId: number): ResolvedLinks => {
	const anchorEdges = db
		.select()
		.from(instalmentAssertions)
		.where(eq(instalmentAssertions.instalmentId, anchorId))
		.all();
	const unitIds = anchorEdges.map((row) => row.unitId);
	if (unitIds.length === 0) {
		return new Map();
	}
	const counterparts = new Map<Service, ResolvedCounterpart[]>();
	const edges = db
		.select()
		.from(instalmentAssertions)
		.where(inArray(instalmentAssertions.unitId, unitIds))
		.all();
	for (const edge of edges) {
		if (edge.instalmentId !== anchorId) {
			addInstalmentCounterpart(db, counterparts, edge);
		}
	}
	const links = new Map<Service, ResolvedLink>();
	for (const [service, list] of counterparts) {
		links.set(service, { counterparts: list, status: "matched" });
	}
	return links;
};

const readInstalment = (
	db: GatewayDb,
	identity: Extract<Identity, { readonly kind: "instalment" }>,
	requested: TitleRow,
): GraphRead => {
	const anchorMatch = and(
		eq(serviceInstalments.titleId, requested.id),
		eq(serviceInstalments.locator, toGraphLocator(identity.locator)),
	);
	const anchor = takeFirst(db.select().from(serviceInstalments).where(anchorMatch).all());
	if (anchor === undefined) {
		return { found: false };
	}
	return {
		answer: { input: identity, kind: "instalment", links: instalmentLinks(db, anchor.id) },
		found: true,
		pendingRef: undefined,
		reviewRef: undefined,
	};
};

const readGraph = (db: GatewayDb, identity: Identity): GraphRead => {
	const member = toGraphMember(identity.title);
	const match = and(
		eq(serviceTitles.service, member.service),
		eq(serviceTitles.serviceId, member.serviceId),
	);
	const requested = takeFirst(db.select().from(serviceTitles).where(match).all());
	if (requested === undefined) {
		return { found: false };
	}
	return identity.kind === "instalment"
		? readInstalment(db, identity, requested)
		: readTitle(db, identity, requested);
};

export { readGraph };
export type { GatewayDb, GraphRead };
