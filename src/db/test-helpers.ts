/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";

import { createDb } from "./index.ts";

const tables = [
	"absence_assertions",
	"atomic_write_gates",
	"instalment_assertions",
	"relation_assertions",
	"title_assertions",
	"title_group_aliases",
	"service_instalments",
	"service_titles",
	"title_groups",
	"content_units",
	"service_coverages",
	"pending_group_candidates",
	"account",
	"episode_progress",
	"personal_rating",
	"session",
	"watch_status",
	"user",
	"verification",
	"todos",
] as const;

const freshDb = async () => {
	await env.DB.batch([
		...tables.map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
		env.DB.prepare("DELETE FROM sqlite_sequence"),
	]);
	return createDb(env.DB);
};

// drizzle wraps the driver error, so the SQLite constraint text lives on the
// cause chain rather than the top-level message. Flattens the chain so a test
// can match the constraint that fired.
const rejectionText = async (promise: Promise<unknown>): Promise<string> => {
	try {
		await promise;
	} catch (error) {
		const parts: string[] = [];
		let current: unknown = error;
		while (current instanceof Error) {
			parts.push(current.message);
			current = current.cause;
		}
		return parts.join("\n");
	}
	throw new Error("expected the query to reject");
};

export { freshDb, rejectionText };
