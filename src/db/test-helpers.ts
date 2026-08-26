/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { getTableName } from "drizzle-orm";
import { env } from "cloudflare:workers";

import { createDb, schema } from "./index.ts";

const tables = Object.values(schema).map((table) => getTableName(table));

const freshDb = async () => {
	await env.DB.batch([
		env.DB.prepare("PRAGMA foreign_keys = OFF"),
		...tables.map((table) => env.DB.prepare(`DELETE FROM ${table}`)),
		env.DB.prepare("DELETE FROM sqlite_sequence"),
		env.DB.prepare("PRAGMA foreign_keys = ON"),
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
