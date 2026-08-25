import { sql } from "drizzle-orm";
import {
	check,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import {
	assertionAuditColumns,
	assertionColumns,
	assertionSources,
	timestamp,
} from "./columns.ts";
import type { AssertionConfidence, AssertionSource } from "./columns.ts";
import type { ContinuityKey, InstalmentLocator } from "./schema.ts";

type Service = string;

const groupSources = [...assertionSources, "release"] as const;
type GroupSource = (typeof groupSources)[number];

const instalmentLocatorKinds = ["service-id", "position"] as const;
type InstalmentLocatorKind = (typeof instalmentLocatorKinds)[number];

const coverageStates = ["complete", "open", "pending", "conflict"] as const;
type CoverageState = (typeof coverageStates)[number];

const pendingCandidateKinds = [
	"structural",
	"fuzzy-group",
	"title-assertion-conflict",
	"instalment-assertion-conflict",
	"absence-assertion-conflict",
	"continuity-conflict",
	"low-confidence-flag",
] as const;
type PendingCandidateKind = (typeof pendingCandidateKinds)[number];

const candidateStatuses = ["open", "accepted", "rejected"] as const;
type CandidateStatus = (typeof candidateStatuses)[number];

// A subject is a whole title (membership candidates) or a narrower pair
// (assertion conflicts), never inferred from `kind` alone by the schema.
type CandidateSubject =
	| { subjectType: "title"; titleId: number }
	| { subjectType: "title-pair"; titleAId: number; titleBId: number }
	| {
			instalmentAId: number;
			instalmentBId: number;
			subjectType: "instalment-pair";
	  };

interface ServiceMember {
	service: Service;
	serviceId: string;
}

interface FuzzyMatchHit {
	score: number;
	service: Service;
	serviceId: string;
	title: string;
	year: number | null;
}

interface FuzzySearchQuery {
	service: Service;
	title: string;
	year: number | null;
}

interface AssertionSnapshot {
	confidence: AssertionConfidence;
	source: AssertionSource;
}

type InstalmentConflictSide = AssertionSnapshot & { unitId: number };
type TitleConflictSide = AssertionSnapshot & {
	titleAId: number;
	titleBId: number;
};

interface CompetingRelation {
	fromTitleId: number;
	source: AssertionSource;
	toTitleId: number;
}

// One evidence shape per `kind`; producers and consumers narrow on `kind`.
type CandidateEvidence =
	| {
			conflictingInstalmentId: number;
			coverageRevision: number;
			kind: "absence-assertion-conflict";
			targetService: Service;
			unitId: number;
	  }
	| {
			competingRelations: CompetingRelation[];
			entryId: string;
			kind: "continuity-conflict";
	  }
	| {
			alsoConsidered: FuzzyMatchHit[];
			kind: "fuzzy-group";
			overCap: FuzzyMatchHit[];
			proposedMembers: FuzzyMatchHit[];
			queries: FuzzySearchQuery[];
	  }
	| {
			instalmentId: number;
			kind: "instalment-assertion-conflict";
			proposed: InstalmentConflictSide;
			published: InstalmentConflictSide | null;
	  }
	| {
			confidence: AssertionConfidence;
			instalmentId: number;
			kind: "low-confidence-flag";
			source: AssertionSource;
			unitId: number;
	  }
	| {
			competingGroupIds: number[];
			kind: "structural";
			proposedMembers: ServiceMember[];
	  }
	| {
			kind: "title-assertion-conflict";
			proposed: TitleConflictSide;
			published: TitleConflictSide | null;
	  };

const contentUnits = sqliteTable("content_units", {
	createdAt: timestamp("created_at"),
	id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
});

const titleGroups = sqliteTable("title_groups", {
	createdAt: timestamp("created_at"),
	id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
	ladderComplete: integer("ladder_complete", { mode: "boolean" })
		.default(false)
		.notNull(),
	source: text({ enum: groupSources }).notNull(),
	updatedAt: timestamp("updated_at").$onUpdateFn(() => new Date()),
});

const serviceTitles = sqliteTable(
	"service_titles",
	{
		createdAt: timestamp("created_at"),
		groupId: integer("group_id")
			.notNull()
			.references(() => titleGroups.id, { onDelete: "cascade" }),
		id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
		ordinal: integer().notNull().default(0),
		service: text().notNull().$type<Service>(),
		serviceId: text("service_id").notNull(),
		updatedAt: timestamp("updated_at").$onUpdateFn(() => new Date()),
	},
	(table) => [
		uniqueIndex("service_titles_service_service_id_idx").on(
			table.service,
			table.serviceId,
		),
	],
);

const serviceInstalments = sqliteTable(
	"service_instalments",
	{
		createdAt: timestamp("created_at"),
		id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
		locator: text().notNull().$type<InstalmentLocator>(),
		locatorKind: text("locator_kind", { enum: instalmentLocatorKinds }).notNull(),
		titleId: integer("title_id")
			.notNull()
			.references(() => serviceTitles.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("service_instalments_title_locator_idx").on(
			table.titleId,
			table.locator,
		),
	],
);

const instalmentAssertions = sqliteTable(
	"instalment_assertions",
	{
		...assertionColumns(),
		instalmentId: integer("instalment_id")
			.notNull()
			.references(() => serviceInstalments.id, { onDelete: "cascade" }),
		unitId: integer("unit_id")
			.notNull()
			.references(() => contentUnits.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("instalment_assertions_instalment_unit_idx").on(
			table.instalmentId,
			table.unitId,
		),
	],
);

const titleAssertions = sqliteTable(
	"title_assertions",
	{
		...assertionColumns(),
		titleAId: integer("title_a_id")
			.notNull()
			.references(() => serviceTitles.id, { onDelete: "cascade" }),
		titleBId: integer("title_b_id")
			.notNull()
			.references(() => serviceTitles.id, { onDelete: "cascade" }),
	},
	(table) => [
		check(
			"title_assertions_canonical_order",
			sql`${table.titleAId} < ${table.titleBId}`,
		),
		uniqueIndex("title_assertions_pair_idx").on(table.titleAId, table.titleBId),
	],
);

const relationAssertions = sqliteTable(
	"relation_assertions",
	{
		...assertionColumns(),
		fromTitleId: integer("from_title_id")
			.notNull()
			.references(() => serviceTitles.id, { onDelete: "cascade" }),
		toTitleId: integer("to_title_id")
			.notNull()
			.references(() => serviceTitles.id, { onDelete: "cascade" }),
	},
	(table) => [
		check(
			"relation_assertions_no_self_edge",
			sql`${table.fromTitleId} <> ${table.toTitleId}`,
		),
		uniqueIndex("relation_assertions_from_idx").on(table.fromTitleId),
		uniqueIndex("relation_assertions_to_idx").on(table.toTitleId),
	],
);

const absenceAssertions = sqliteTable(
	"absence_assertions",
	{
		...assertionAuditColumns(),
		coverageRevision: integer("coverage_revision").notNull(),
		targetService: text("target_service").notNull().$type<Service>(),
		unitId: integer("unit_id")
			.notNull()
			.references(() => contentUnits.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("absence_assertions_unit_service_revision_idx").on(
			table.unitId,
			table.targetService,
			table.coverageRevision,
		),
	],
);

const serviceCoverages = sqliteTable(
	"service_coverages",
	{
		baselineContinuity: text("baseline_continuity")
			.notNull()
			.$type<ContinuityKey>(),
		createdAt: timestamp("created_at"),
		id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
		revision: integer().notNull(),
		state: text({ enum: coverageStates }).notNull(),
		targetService: text("target_service").notNull().$type<Service>(),
		updatedAt: timestamp("updated_at").$onUpdateFn(() => new Date()),
	},
	(table) => [
		uniqueIndex("service_coverages_baseline_service_revision_idx").on(
			table.baselineContinuity,
			table.targetService,
			table.revision,
		),
	],
);

const pendingGroupCandidates = sqliteTable(
	"pending_group_candidates",
	{
		createdAt: timestamp("created_at"),
		evidence: text({ mode: "json" }).notNull().$type<CandidateEvidence>(),
		evidenceHash: text("evidence_hash").notNull(),
		id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
		kind: text({ enum: pendingCandidateKinds }).notNull(),
		status: text({ enum: candidateStatuses }).notNull().default("open"),
		subject: text({ mode: "json" }).notNull().$type<CandidateSubject>(),
		updatedAt: timestamp("updated_at").$onUpdateFn(() => new Date()),
	},
	(table) => [
		uniqueIndex("pending_group_candidates_open_idx")
			.on(table.kind, table.subject, table.evidenceHash)
			.where(sql`${table.status} = 'open'`),
	],
);

const titleGroupAliases = sqliteTable(
	"title_group_aliases",
	{
		createdAt: timestamp("created_at"),
		id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
		retiredGroupId: integer("retired_group_id")
			.notNull()
			.references(() => titleGroups.id, { onDelete: "cascade" }),
		survivorGroupId: integer("survivor_group_id")
			.notNull()
			.references(() => titleGroups.id, { onDelete: "cascade" }),
		updatedAt: timestamp("updated_at").$onUpdateFn(() => new Date()),
	},
	(table) => [
		check(
			"title_group_aliases_not_self",
			sql`${table.retiredGroupId} != ${table.survivorGroupId}`,
		),
		// One retired group resolves to exactly one survivor; flattening
		// alias-of-alias chains to that survivor is the writer's job.
		uniqueIndex("title_group_aliases_retired_group_id_idx").on(
			table.retiredGroupId,
		),
	],
);

export {
	absenceAssertions,
	candidateStatuses,
	contentUnits,
	coverageStates,
	groupSources,
	instalmentAssertions,
	instalmentLocatorKinds,
	pendingCandidateKinds,
	pendingGroupCandidates,
	relationAssertions,
	serviceCoverages,
	serviceInstalments,
	serviceTitles,
	titleAssertions,
	titleGroupAliases,
	titleGroups,
};
export { assertionConfidences, assertionSources } from "./columns.ts";
export type {
	CandidateEvidence,
	CandidateStatus,
	CandidateSubject,
	CoverageState,
	GroupSource,
	InstalmentLocatorKind,
	PendingCandidateKind,
	Service,
};
export type { AssertionConfidence, AssertionSource } from "./columns.ts";
