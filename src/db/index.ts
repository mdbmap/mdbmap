import { drizzle } from "drizzle-orm/d1";

import {
	absenceAssertions,
	atomicWriteGates,
	contentUnits,
	instalmentAssertions,
	pendingGroupCandidates,
	relationAssertions,
	serviceCoverages,
	serviceInstalments,
	serviceTitles,
	titleAssertions,
	titleGroupAliases,
	titleGroups,
} from "./engine-schema.ts";
import {
	account,
	apiKey,
	episodeProgress,
	llmProvider,
	personalRating,
	researchPolicy,
	session,
	todos,
	user,
	verification,
	watchStatus,
} from "./schema.ts";

const schema = {
	absenceAssertions,
	account,
	apiKey,
	atomicWriteGates,
	contentUnits,
	episodeProgress,
	instalmentAssertions,
	llmProvider,
	pendingGroupCandidates,
	personalRating,
	relationAssertions,
	researchPolicy,
	serviceCoverages,
	serviceInstalments,
	serviceTitles,
	session,
	titleAssertions,
	titleGroupAliases,
	titleGroups,
	todos,
	user,
	verification,
	watchStatus,
};

const createDb = (database: D1Database) => drizzle(database, { schema });
type Db = ReturnType<typeof createDb>;

// Resolved per request so the Workers-only `cloudflare:workers` import is never
// evaluated under Node, mirroring `resolveMetadataKv`. The runtime db is D1
// (async); tests bind to a local D1 through `cloudflare:test`.
const resolveDb = async () => {
	const { env } = await import("cloudflare:workers");
	return createDb(env.DB);
};

export { ascendingPair, one } from "./one.ts";
export { createDb, resolveDb, schema };
export type { Db };
