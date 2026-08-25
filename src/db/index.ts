import { drizzle } from "drizzle-orm/d1";

import {
	absenceAssertions,
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
	episodeProgress,
	personalRating,
	session,
	todos,
	user,
	verification,
	watchStatus,
} from "./schema.ts";

const schema = {
	absenceAssertions,
	account,
	contentUnits,
	episodeProgress,
	instalmentAssertions,
	pendingGroupCandidates,
	personalRating,
	relationAssertions,
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

// Resolved per request so the Workers-only `cloudflare:workers` import is never
// evaluated under Node, mirroring `resolveMetadataKv`. The runtime db is D1
// (async); tests inject their own async in-memory db instead.
const resolveDb = async () => {
	const { env } = await import("cloudflare:workers");
	return drizzle(env.DB, { schema });
};

export { resolveDb };
