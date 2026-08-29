import { createFileRoute } from "@tanstack/react-router";

import { runMapping } from "@/engine/gateway";
import { createLiveColdLookup, resolveIngestEnv } from "@/engine/ingest";
import { withPublicApiGate } from "@/lib/api-key";

const liveColdLookup = createLiveColdLookup({
	resolveIngest: resolveIngestEnv,
});

const runSeriesMapping = async (id: string): Promise<Response> =>
	runMapping("series", id, { coldLookup: liveColdLookup });

export const Route = createFileRoute("/series/$id")({
	server: {
		handlers: {
			GET: async ({ params, request }) =>
				withPublicApiGate(request, async () => runSeriesMapping(params.id)),
		},
	},
});
