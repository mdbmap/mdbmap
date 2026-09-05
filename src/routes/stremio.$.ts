import { createFileRoute } from "@tanstack/react-router";

import { resolveDb } from "@/db";
import { createEngine } from "@/engine";
import { continuityKey } from "@/engine/continuity/keys";
import { resolveMapping } from "@/engine/gateway";
import { createLiveColdLookup, resolveIngestEnv } from "@/engine/ingest";
import { defaultProviders, fetchDisplayMetadata } from "@/orpc/providers";
import { handleStremioRequest, stremioOptionsResponse } from "@/stremio";

const liveColdLookup = createLiveColdLookup({
	resolveIngest: resolveIngestEnv,
});

const handle = async ({ request }: { request: Request }) => {
	const db = await resolveDb();
	const engine = createEngine(db);
	return handleStremioRequest(request, {
		display: async (continuityId) =>
			fetchDisplayMetadata(
				defaultProviders,
				await engine.resolveContinuity(continuityKey(continuityId)),
			),
		resolve: async (profile, rawId) =>
			resolveMapping(db, profile, rawId, liveColdLookup),
		search: async (query, mediaKind) =>
			defaultProviders.catalogueSearch.search(query, { mediaKind }),
	});
};

export const Route = createFileRoute("/stremio/$")({
	server: {
		handlers: {
			GET: handle,
			HEAD: handle,
			OPTIONS: () => stremioOptionsResponse(),
		},
	},
});
