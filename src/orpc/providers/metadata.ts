import { resolveDb } from "@/db";
import { env } from "@/env";

import { anidbStubProvider } from "./metadata-anidb.ts";
import { createD1MetadataStore } from "./metadata-store.ts";
import type { MetadataStore } from "./metadata-store.ts";
import { createTmdbProvider } from "./metadata-tmdb.ts";
import type { MetadataProvider, MetadataRegistry } from "./types.ts";

const resolveMetadataStore = async (): Promise<MetadataStore> =>
	createD1MetadataStore(await resolveDb());

const tmdbProvider = createTmdbProvider({
	apiKey: env.TMDB_API_KEY,
	resolveStore: resolveMetadataStore,
});

const metadataRegistry: MetadataRegistry = {
	anidb: anidbStubProvider,
	tmdb: tmdbProvider,
} satisfies Readonly<Record<"anidb" | "tmdb", MetadataProvider>>;

export { metadataRegistry };
