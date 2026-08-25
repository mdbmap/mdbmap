import type { Promisable } from "type-fest";

import type { Identity, Profile } from "@/engine/identity.ts";

// The build a cold path started for an id absent from the graph. Its status URL
// is opaque to the client and its Retry-After suggests when to poll again.
interface PendingBuild {
	readonly retryAfterSeconds: number;
	readonly statusUrl: string;
}

// What a cache miss produced: a started build to wait on, or nothing.
type ColdResult =
	| { readonly build: PendingBuild; readonly kind: "started" }
	| { readonly kind: "miss" };

// The hand-off a cache miss takes: `begin` spawns a build, a "started" result
// answers 202 and a "miss" leaves the request as a 404.
interface ColdLookup {
	readonly begin: (identity: Identity, profile: Profile) => Promisable<ColdResult>;
}

const missed: ColdResult = { kind: "miss" };

// A no-op hand-off: every miss falls straight through to 404.
const noColdLookup: ColdLookup = {
	begin: () => missed,
};

export { noColdLookup };
export type { ColdLookup, ColdResult, PendingBuild };
