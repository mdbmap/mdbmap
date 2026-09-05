import type { ResolveResult } from "@/engine";
import { metadataProviderFor } from "@/engine";

import type { MetadataFetchOptions } from "./metadata-freshness.ts";
import type { Providers, WorkMetadata } from "./types.ts";

const fetchDisplayMetadata = async (
	providers: Providers,
	resolved: ResolveResult,
	options: MetadataFetchOptions = {},
): Promise<WorkMetadata> => {
	const kindProvider =
		providers.metadata[metadataProviderFor(resolved.mediaKind)];
	if (resolved.mediaKind !== "anime") {
		return kindProvider.fetchWork(resolved, options);
	}
	const meta = await kindProvider.fetchWork(resolved, options);
	if (meta.genres.length > 0) {
		return meta;
	}
	try {
		const tmdb = await providers.metadata.tmdb.fetchWork(resolved, {
			force: false,
			refreshIfDue: false,
			...(options.locale === undefined ? {} : { locale: options.locale }),
			...(options.now === undefined ? {} : { now: options.now }),
		});
		return { ...meta, genres: [...tmdb.genres] };
	} catch {
		return meta;
	}
};

export { fetchDisplayMetadata };
