import { createFileRoute } from "@tanstack/react-router";

import { runMapping } from "@/engine/gateway";
import { createLiveColdLookup, resolveIngestEnv } from "@/engine/ingest";
import { withPublicApiGate } from "@/lib/api-key";

const liveColdLookup = createLiveColdLookup({
	resolveIngest: resolveIngestEnv,
});

const runMovieMapping = async (id: string): Promise<Response> =>
	runMapping("movie", id, { coldLookup: liveColdLookup });

export const Route = createFileRoute("/movie/$id")({
	server: {
		handlers: {
			GET: async ({ params, request }) =>
				withPublicApiGate(request, async () => runMovieMapping(params.id)),
		},
	},
});
