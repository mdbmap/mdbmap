/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { getTableName } from "drizzle-orm";

import { createDb, schema } from "./index.ts";

// Children before parents so DELETE respects D1 FK enforcement. Asserted against
// `schema` so a new table fails the harness load instead of leaking across tests.
const wipeOrder = [
	"api_key",
	"absence_assertions",
	"instalment_assertions",
	"title_assertions",
	"presentation_order_proposal_items",
	"presentation_order_proposals",
	"presentation_order_items",
	"presentation_orders",
	"continuity_segments",
	"continuity_aliases",
	"relation_assertions",
	"service_instalments",
	"service_titles",
	"title_group_aliases",
	"pending_group_candidates",
	"service_coverages",
	"atomic_write_gates",
	"content_units",
	"continuities",
	"title_groups",
	"episode_progress",
	"personal_rating",
	"watch_status",
	"work_note",
	"catalogue_metadata",
	"metadata_refresh_lease",
	"stripe_webhook_event",
	"sync_account_link",
	"sync_entitlement",
	"llm_provider",
	"research_policy",
	"session",
	"account",
	"user",
	"verification",
] as const;

const schemaTables = new Set(
	Object.values(schema).map((table) => getTableName(table)),
);
if (
	wipeOrder.length !== schemaTables.size ||
	wipeOrder.some((name) => !schemaTables.has(name))
) {
	throw new Error("wipeOrder drifted from db schema tables");
}

const freshDb = async () => {
	await env.DB.batch([
		...wipeOrder.map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
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
