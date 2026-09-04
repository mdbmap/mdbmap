import { drizzle } from "drizzle-orm/d1";

import {
	absenceAssertions,
	atomicWriteGates,
	contentUnits,
	continuities,
	continuityAliases,
	continuitySegments,
	instalmentAssertions,
	pendingGroupCandidates,
	presentationOrderItems,
	presentationOrderProposalItems,
	presentationOrderProposals,
	presentationOrders,
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
	stripeWebhookEvent,
	syncAccountLink,
	syncEntitlement,
	user,
	verification,
	watchStatus,
	workNote,
} from "./schema.ts";

const schema = {
	absenceAssertions,
	account,
	apiKey,
	atomicWriteGates,
	contentUnits,
	continuities,
	continuityAliases,
	continuitySegments,
	episodeProgress,
	instalmentAssertions,
	llmProvider,
	pendingGroupCandidates,
	personalRating,
	presentationOrderItems,
	presentationOrderProposalItems,
	presentationOrderProposals,
	presentationOrders,
	relationAssertions,
	researchPolicy,
	serviceCoverages,
	serviceInstalments,
	serviceTitles,
	session,
	stripeWebhookEvent,
	syncAccountLink,
	syncEntitlement,
	titleAssertions,
	titleGroupAliases,
	titleGroups,
	user,
	verification,
	watchStatus,
	workNote,
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
