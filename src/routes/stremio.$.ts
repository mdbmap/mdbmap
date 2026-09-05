import { createFileRoute } from "@tanstack/react-router";

import { resolveDb } from "@/db";
import { resolveMapping } from "@/engine/gateway";
import { createLiveColdLookup, resolveIngestEnv } from "@/engine/ingest";
import { defaultProviders } from "@/orpc/providers";
import { handleStremioRequest, stremioOptionsResponse } from "@/stremio";

const liveColdLookup = createLiveColdLookup({
	resolveIngest: resolveIngestEnv,
});

const handle = async ({ request }: { request: Request }) =>
	handleStremioRequest(request, {
		resolve: async (profile, rawId) =>
			resolveMapping(await resolveDb(), profile, rawId, liveColdLookup),
		search: async (query, mediaKind) =>
			defaultProviders.catalogueSearch.search(query, { mediaKind }),
	});

export const Route = createFileRoute("/stremio/$")({
	server: {
		handlers: {
			GET: handle,
			HEAD: handle,
			OPTIONS: () => stremioOptionsResponse(),
		},
	},
});
