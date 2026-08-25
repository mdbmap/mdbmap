import { env } from "@/env";

import { anidbStubProvider } from "./metadata-anidb.ts";
import type { MetadataKv } from "./metadata-tmdb.ts";
import { createTmdbProvider } from "./metadata-tmdb.ts";
import type { MetadataProvider, MetadataRegistry } from "./types.ts";

// Resolved lazily so the Workers-only `cloudflare:workers` import is never
// evaluated under Node (tests inject their own KV-backed provider instead).
const resolveMetadataKv = async (): Promise<MetadataKv> => {
	const { env: workerEnv } = await import("cloudflare:workers");
	const namespace = workerEnv.METADATA_KV;
	return {
		get: async (key) => (await namespace.get(key)) ?? undefined,
		put: async (key, value, options) => {
			await namespace.put(key, value, options);
		},
	};
};

const tmdbProvider = createTmdbProvider({
	apiKey: env.TMDB_API_KEY,
	resolveKv: resolveMetadataKv,
});

const metadataRegistry: MetadataRegistry = {
	anidb: anidbStubProvider,
	tmdb: tmdbProvider,
} satisfies Readonly<Record<"anidb" | "tmdb", MetadataProvider>>;

export { metadataRegistry };
