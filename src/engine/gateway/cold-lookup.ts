import type { Promisable } from "type-fest";

import type { Identity, Profile } from "@/engine/identity.ts";

// The build a cold path started for an id absent from the graph. Its status URL
// is opaque to the client and its Retry-After suggests when to poll again.
interface PendingBuild {
	readonly retryAfterSeconds: number;
	readonly statusUrl: string;
}

type ColdResult =
	| { readonly build: PendingBuild; readonly kind: "started" }
	| { readonly kind: "miss" }
	| { readonly kind: "updated" };

interface ColdLookup {
	readonly begin: (
		identity: Identity,
		profile: Profile,
	) => Promisable<ColdResult>;
}

const missed: ColdResult = { kind: "miss" };

// A no-op hand-off: every miss falls straight through to 404.
const noColdLookup: ColdLookup = {
	begin: () => missed,
};

export { noColdLookup };
export type { ColdLookup, ColdResult, PendingBuild };
