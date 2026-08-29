import { createFileRoute } from "@tanstack/react-router";

import { runMapping } from "@/engine/gateway";
import { createLiveColdLookup, resolveIngestEnv } from "@/engine/ingest";
import { withPublicApiGate } from "@/lib/api-key";

const runSeriesMapping = async (id: string): Promise<Response> => {
	const ingest = await resolveIngestEnv();
	return runMapping("series", id, {
		coldLookup: createLiveColdLookup({ ingest }),
		db: ingest.db,
	});
};

export const Route = createFileRoute("/series/$id")({
	server: {
		handlers: {
			GET: async ({ params, request }) =>
				withPublicApiGate(request, async () => runSeriesMapping(params.id)),
		},
	},
});
