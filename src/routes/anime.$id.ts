import { createFileRoute } from "@tanstack/react-router";

import { runMapping } from "@/engine/gateway";
import { createLiveColdLookup, resolveIngestEnv } from "@/engine/ingest";
import { withPublicApiGate } from "@/lib/api-key";

const liveColdLookup = createLiveColdLookup({
	resolveIngest: resolveIngestEnv,
});

const runAnimeMapping = async (id: string): Promise<Response> =>
	runMapping("anime", id, { coldLookup: liveColdLookup });

export const Route = createFileRoute("/anime/$id")({
	server: {
		handlers: {
			GET: async ({ params, request }) =>
				withPublicApiGate(request, async () => runAnimeMapping(params.id)),
		},
	},
});
