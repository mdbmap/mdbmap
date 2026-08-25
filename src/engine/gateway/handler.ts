import { resolveDb } from "@/db";

import type { Profile } from "@/engine/identity.ts";
import { noColdLookup } from "./cold-lookup.ts";
import type { ColdLookup } from "./cold-lookup.ts";
import type { GatewayDb } from "./read.ts";
import { resolveMapping } from "./resolve.ts";
import { toResponse } from "./respond.ts";

// Everything the route reads is injectable so tests drive a fresh in-memory db
// and a stubbed cold path; production falls back to the shared db and the no-op
// cold lookup.
interface GatewayDeps {
	readonly coldLookup?: ColdLookup;
	readonly db?: GatewayDb;
}

const runMapping = async (
	profile: Profile,
	rawId: string,
	deps: GatewayDeps = {},
): Promise<Response> => {
	const outcome = await resolveMapping(
		deps.db ?? (await resolveDb()),
		profile,
		rawId,
		deps.coldLookup ?? noColdLookup,
	);
	return toResponse(outcome);
};

export { runMapping };
export type { GatewayDeps };
