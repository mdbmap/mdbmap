import { sql } from "drizzle-orm";
import { integer, text } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) =>
	integer(name, { mode: "timestamp" })
		.default(sql`(unixepoch())`)
		.notNull();

const assertionConfidences = ["high", "low"] as const;
type AssertionConfidence = (typeof assertionConfidences)[number];

const assertionSources = [
	"bootstrap",
	"t1-structure",
	"t2-pattern",
	"t3-episode",
	"llm-research",
	"llm-verified",
	"community",
	"manual",
] as const;
type AssertionSource = (typeof assertionSources)[number];

const assertionAuditColumns = () => ({
	createdAt: timestamp("created_at"),
	id: integer({ mode: "number" }).primaryKey({ autoIncrement: true }),
	source: text({ enum: assertionSources }).notNull(),
});

const assertionColumns = () => ({
	confidence: text({ enum: assertionConfidences }).notNull(),
	...assertionAuditColumns(),
});

export {
	assertionAuditColumns,
	assertionColumns,
	assertionConfidences,
	assertionSources,
	timestamp,
};
export type { AssertionConfidence, AssertionSource };
