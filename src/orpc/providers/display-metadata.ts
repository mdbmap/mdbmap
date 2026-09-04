import type { ResolveResult } from "@/engine";
import { metadataProviderFor } from "@/engine";

import type { Providers, WorkMetadata } from "./types.ts";

const fetchDisplayMetadata = async (
	providers: Providers,
	resolved: ResolveResult,
): Promise<WorkMetadata> => {
	const kindProvider =
		providers.metadata[metadataProviderFor(resolved.mediaKind)];
	if (resolved.mediaKind !== "anime") {
		return kindProvider.fetchWork(resolved);
	}
	const animeGenres = async (): Promise<string[]> => {
		try {
			const tmdb = await providers.metadata.tmdb.fetchWork(resolved);
			return [...tmdb.genres];
		} catch {
			return [];
		}
	};
	const [meta, genres] = await Promise.all([
		kindProvider.fetchWork(resolved),
		animeGenres(),
	]);
	return { ...meta, genres };
};

export { fetchDisplayMetadata };
