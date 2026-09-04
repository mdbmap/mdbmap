import { sql } from "drizzle-orm";
import {
	check,
	integer,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { timestamp } from "./columns.ts";

// Opaque engine identity; canonical construction lives in continuity/keys.ts.
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

// Provisional Vercel AI SDK adapter subset (ADR-0005).
const vercelAiSdkProviderKinds = [
	"openai",
	"anthropic",
	"google",
	"mistral",
	"groq",
	"xai",
] as const;

const llmProviderKinds = [
	...vercelAiSdkProviderKinds,
	"openai-compatible",
] as const;
type LlmProviderKind = (typeof llmProviderKinds)[number];

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

// AES-GCM envelope encryption (ADR-0005): `ciphertext` holds the encrypted
// provider config JSON, `wrappedKey` its per-record data key encrypted under
// the deploy-time master key. `kind` and `label` stay plaintext for identity
// and filtering without decrypt; the admin list still decrypts each row for
// public config fields (model / baseUrl) shown in the panel.
const llmProvider = sqliteTable("llm_provider", {
	ciphertext: text().notNull(),
	createdAt: timestamp("created_at"),
	dataIv: text("data_iv").notNull(),
	id: text()
		.primaryKey()
		.$defaultFn(() => crypto.randomUUID()),
	kind: text({ enum: llmProviderKinds }).notNull(),
	label: text().notNull(),
	updatedAt: timestamp("updated_at").$onUpdateFn(() => new Date()),
	wrapIv: text("wrap_iv").notNull(),
	wrappedKey: text("wrapped_key").notNull(),
});

// ADR-0004 deployment policy: when the research pass runs relative to the
// deterministic build. Singleton row (`id = "default"`); absent means `off`.
const researchTimings = ["before-builds", "after-residue", "off"] as const;
type ResearchTiming = (typeof researchTimings)[number];
const DEFAULT_RESEARCH_TIMING: ResearchTiming = "off";

const researchPolicy = sqliteTable("research_policy", {
	id: text().primaryKey(),
	timing: text({ enum: researchTimings }).notNull(),
	updatedAt: timestamp("updated_at").$onUpdateFn(() => new Date()),
});

// ADR-0009: sync gate reads this row; Stripe webhooks write it. No receipt
// payloads — only coarse status and provider ids.
const syncEntitlementStatuses = ["active", "inactive"] as const;
type SyncEntitlementStatus = (typeof syncEntitlementStatuses)[number];

const syncEntitlement = sqliteTable("sync_entitlement", {
	periodEnd: integer("period_end", { mode: "timestamp" }),
	status: text({ enum: syncEntitlementStatuses }).notNull().default("inactive"),
	stripeCustomerId: text("stripe_customer_id"),
	stripeSubscriptionId: text("stripe_subscription_id"),
	updatedAt: timestamp("updated_at").$onUpdateFn(() => new Date()),
	userId: text("user_id")
		.primaryKey()
		.references(() => user.id, { onDelete: "cascade" }),
});

export {
	account,
	apiKey,
	apiKeyPlans,
	episodeProgress,
	llmProvider,
	llmProviderKinds,
	personalRating,
	rateableUnitKinds,
	researchPolicy,
	researchTimings,
	DEFAULT_RESEARCH_TIMING,
	session,
	syncEntitlement,
	syncEntitlementStatuses,
	user,
	vercelAiSdkProviderKinds,
	verification,
	watchStatus,
	watchStatuses,
};
export type {
	ApiKeyPlan,
	ContinuityKey,
	InstalmentLocator,
	LlmProviderKind,
	RateableUnitKey,
	RateableUnitKind,
	ResearchTiming,
	SyncEntitlementStatus,
	WatchStatus,
};
