import { sql } from "drizzle-orm";
import {
	check,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { timestamp } from "./columns.ts";

// Provisional opaque keys onto engine identities; #4 finalises their shapes.
type ContinuityKey = string;
type InstalmentLocator = string;
type RateableUnitKey = string;

const watchStatuses = [
	"watching",
	"on_hold",
	"completed",
	"dropped",
	"rewatching",
] as const;
type WatchStatus = (typeof watchStatuses)[number];

const rateableUnitKinds = ["work", "part", "episode", "movie"] as const;
type RateableUnitKind = (typeof rateableUnitKinds)[number];

// The gate (#56) picks its binding from this column; new plans just add a value.
const apiKeyPlans = ["free", "pro"] as const;
type ApiKeyPlan = (typeof apiKeyPlans)[number];

const todos = sqliteTable("todos", {
	createdAt: integer("created_at", { mode: "timestamp" }).default(
		sql`(unixepoch())`,
	),
	id: integer({ mode: "number" }).primaryKey({
		autoIncrement: true,
	}),
	title: text().notNull(),
});

// `role`, `banned`, `banReason` and `banExpires` back Better-Auth's admin plugin
// (the moderation surface gates on `role` containing `admin`).
const user = sqliteTable("user", {
	banExpires: integer("ban_expires", { mode: "timestamp" }),
	banReason: text("ban_reason"),
	banned: integer({ mode: "boolean" }),
	createdAt: timestamp("created_at"),
	email: text().notNull().unique(),
	emailVerified: integer("email_verified", { mode: "boolean" })
		.default(false)
		.notNull(),
	id: text().primaryKey(),
	image: text(),
	name: text().notNull(),
	role: text().default("user"),
	updatedAt: timestamp("updated_at").$onUpdateFn(() => new Date()),
});

const session = sqliteTable("session", {
	createdAt: timestamp("created_at"),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	id: text().primaryKey(),
	impersonatedBy: text("impersonated_by"),
	ipAddress: text("ip_address"),
	token: text().notNull().unique(),
	updatedAt: timestamp("updated_at").$onUpdateFn(() => new Date()),
	userAgent: text("user_agent"),
	userId: text("user_id")
		.notNull()
		.references(() => user.id, { onDelete: "cascade" }),
});

const account = sqliteTable(
	"account",
	{
		accessToken: text("access_token"),
		accessTokenExpiresAt: integer("access_token_expires_at", {
			mode: "timestamp",
		}),
		accountId: text("account_id").notNull(),
		createdAt: timestamp("created_at"),
		id: text().primaryKey(),
		idToken: text("id_token"),
		issuer: text().notNull(),
		password: text(),
		providerId: text("provider_id").notNull(),
		refreshToken: text("refresh_token"),
		refreshTokenExpiresAt: integer("refresh_token_expires_at", {
			mode: "timestamp",
		}),
		scope: text(),
		updatedAt: timestamp("updated_at").$onUpdateFn(() => new Date()),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("account_issuer_account_id_idx").on(
			table.issuer,
			table.accountId,
		),
	],
);

const verification = sqliteTable("verification", {
	createdAt: timestamp("created_at"),
	expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
	id: text().primaryKey(),
	identifier: text().notNull(),
	updatedAt: timestamp("updated_at").$onUpdateFn(() => new Date()),
	value: text().notNull(),
});

// ADR-0006: hand-rolled, not better-auth's api-key plugin (which writes a
// request count to D1 on every verification). Only `keyHash` is ever stored;
// the full secret exists once, at issuance.
const apiKey = sqliteTable("api_key", {
	createdAt: timestamp("created_at"),
	id: text().primaryKey(),
	keyHash: text("key_hash").notNull().unique(),
	label: text().notNull(),
	plan: text({ enum: apiKeyPlans }).notNull().default("free"),
	revokedAt: integer("revoked_at", { mode: "timestamp" }),
});

const watchStatus = sqliteTable(
	"watch_status",
	{
		continuityKey: text("continuity_key").notNull().$type<ContinuityKey>(),
		id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
		rewatchCount: integer("rewatch_count").notNull().default(0),
		status: text({ enum: watchStatuses }).notNull(),
		updatedAt: timestamp("updated_at").$onUpdateFn(() => new Date()),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		uniqueIndex("watch_status_user_continuity_idx").on(
			table.userId,
			table.continuityKey,
		),
	],
);

const episodeProgress = sqliteTable(
	"episode_progress",
	{
		id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
		instalmentLocator: text("instalment_locator")
			.notNull()
			.$type<InstalmentLocator>(),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
		watchedAt: timestamp("watched_at"),
	},
	(table) => [
		uniqueIndex("episode_progress_user_instalment_idx").on(
			table.userId,
			table.instalmentLocator,
		),
	],
);

const personalRating = sqliteTable(
	"personal_rating",
	{
		id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
		score: integer().notNull(),
		unitKey: text("unit_key").notNull().$type<RateableUnitKey>(),
		unitKind: text("unit_kind", { enum: rateableUnitKinds }).notNull(),
		updatedAt: timestamp("updated_at").$onUpdateFn(() => new Date()),
		userId: text("user_id")
			.notNull()
			.references(() => user.id, { onDelete: "cascade" }),
	},
	(table) => [
		check("personal_rating_score_range", sql`${table.score} between 1 and 10`),
		uniqueIndex("personal_rating_user_unit_idx").on(
			table.userId,
			table.unitKind,
			table.unitKey,
		),
	],
);

export {
	account,
	apiKey,
	apiKeyPlans,
	episodeProgress,
	personalRating,
	rateableUnitKinds,
	session,
	todos,
	user,
	verification,
	watchStatus,
	watchStatuses,
};
export type {
	ApiKeyPlan,
	ContinuityKey,
	InstalmentLocator,
	RateableUnitKey,
	RateableUnitKind,
	WatchStatus,
};
