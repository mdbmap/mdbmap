import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import type { Promisable } from "type-fest";

import type { EngineRead } from "@/engine";

import type { Providers } from "./providers";

// Accepts both the schema-typed production db and a schemaless in-memory db.
type Db = BaseSQLiteDatabase<"sync", unknown, Record<string, unknown>>;

interface SessionUser {
	id: string;
	// Better-Auth admin plugin roles as its stored comma-separated string; absent
	// when the resolver could not read one.
	role?: string;
}

type ResolveSession = (
	headers: Headers | undefined,
) => Promisable<SessionUser | undefined>;

// Everything past `headers` is injectable so the seam can be driven with a
// fresh in-memory db and a stubbed session in tests; production passes only
// `headers` and the middleware fills the rest with defaults.
interface ORPCContext {
	db?: Db;
	engine?: EngineRead;
	headers?: Headers;
	providers?: Providers;
	resolveSession?: ResolveSession;
}

export type { Db, ORPCContext, ResolveSession, SessionUser };
