import { createFileRoute } from "@tanstack/react-router";

import { runMapping } from "@/engine/gateway";
import { createLiveColdLookup, resolveIngestEnv } from "@/engine/ingest";
import { withPublicApiGate } from "@/lib/api-key";

const runAnimeMapping = async (id: string): Promise<Response> => {
	const ingest = await resolveIngestEnv();
	return runMapping("anime", id, {
		coldLookup: createLiveColdLookup({ ingest }),
		db: ingest.db,
	});
};

export const Route = createFileRoute("/anime/$id")({
	server: {
		handlers: {
			GET: async ({ params, request }) =>
				withPublicApiGate(request, async () => runAnimeMapping(params.id)),
		},
	},
});
