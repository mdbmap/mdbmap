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
import type { ContinuityKey, InstalmentLocator } from "./schema.ts";

type Service = string;

const groupSources = [...assertionSources, "release"] as const;
type GroupSource = (typeof groupSources)[number];

const instalmentLocatorKinds = ["service-id", "position"] as const;
type InstalmentLocatorKind = (typeof instalmentLocatorKinds)[number];

const coverageStates = ["complete", "open", "pending", "conflict"] as const;
type CoverageState = (typeof coverageStates)[number];

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

export {
	absenceAssertions,
	contentUnits,
	coverageStates,
	groupSources,
	instalmentAssertions,
	instalmentLocatorKinds,
	relationAssertions,
	serviceCoverages,
	serviceInstalments,
	serviceTitles,
	titleAssertions,
	titleGroups,
};
export { assertionConfidences, assertionSources } from "./columns.ts";
export type { CoverageState, GroupSource, InstalmentLocatorKind, Service };
export type { AssertionConfidence, AssertionSource } from "./columns.ts";
