import type { Promisable } from "type-fest";

import type { Db } from "@/db";
import type { EngineRead } from "@/engine";

import type { Providers } from "./providers";

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
	providerConfigMasterKey?: string;
	providers?: Providers;
	resolveSession?: ResolveSession;
}

export type { Db } from "@/db";
export type { ORPCContext, ResolveSession, SessionUser };
