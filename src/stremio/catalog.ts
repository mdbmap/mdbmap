import { ExtraTypes } from "stremio-types";
import type { ContentType, MetaItemPreview } from "stremio-types";
import type { Promisable } from "type-fest";

import type { MediaKind } from "@/engine";
import type { MappingOutcome } from "@/engine/gateway";
import { formatId } from "@/engine/identity.ts";
import type { Profile, TitleIdentity } from "@/engine/identity.ts";
import type { CatalogueSearchHit } from "@/orpc/providers";
import type { CatalogueTitle } from "@/orpc/schema";

import { CATALOG_IDS } from "./manifest.ts";
import { imdbTitleIdFromMapping } from "./videos.ts";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";
const TMDB_REF_PREFIX = "tmdb:";

const titleIdentityOf = (catalogue: CatalogueTitle): TitleIdentity => {
	switch (catalogue.service) {
		case "anilist": {
			return { id: catalogue.id, service: "anilist" };
		}
		case "imdb": {
			return { id: catalogue.id, service: "imdb" };
		}
		case "kitsu": {
			return { id: catalogue.id, service: "kitsu" };
		}
		case "mal": {
			return { id: catalogue.id, service: "mal" };
		}
		case "tmdb": {
			return {
				id: catalogue.id,
				namespace: catalogue.namespace,
				service: "tmdb",
			};
		}
		case "tvdb": {
			return { id: catalogue.id, service: "tvdb" };
		}
	}
};

const posterUrl = (coverRef: string | undefined): string | undefined => {
	if (coverRef === undefined || coverRef === "") {
		return undefined;
	}
	if (coverRef.startsWith("https://") || coverRef.startsWith("http://")) {
		return coverRef;
	}
	if (!coverRef.startsWith(TMDB_REF_PREFIX)) {
		return undefined;
	}
	const path = coverRef.slice(TMDB_REF_PREFIX.length);
	return `${TMDB_IMAGE_BASE}${path.startsWith("/") ? path : `/${path}`}`;
};

const previewOf = (
	hit: CatalogueSearchHit,
	type: ContentType,
): MetaItemPreview => {
	const poster = posterUrl(hit.coverRef);
	const year = hit.year === undefined ? undefined : String(hit.year);
	return {
		id: formatId({ kind: "title", title: titleIdentityOf(hit.catalogue) }),
		name: hit.title,
		type,
		...(poster === undefined ? {} : { poster }),
		...(year === undefined ? {} : { releaseInfo: year }),
	};
};

const previewsFromHits = (
	hits: readonly CatalogueSearchHit[],
	type: ContentType,
): MetaItemPreview[] => {
	const previews: MetaItemPreview[] = [];
	for (const hit of hits) {
		if (hit.title === "") {
			continue;
		}
		previews.push(previewOf(hit, type));
	}
	return previews;
};

const mediaKindForCatalog = (catalogId: string): MediaKind | undefined => {
	switch (catalogId) {
		case CATALOG_IDS.anime: {
			return "anime";
		}
		case CATALOG_IDS.movie: {
			return "film";
		}
		case CATALOG_IDS.series: {
			return "tv";
		}
		default: {
			return undefined;
		}
	}
};

const profileForMediaKind = (mediaKind: MediaKind): Profile => {
	switch (mediaKind) {
		case "anime": {
			return "anime";
		}
		case "film": {
			return "movie";
		}
		case "tv": {
			return "series";
		}
	}
};

const mappingBodyOf = (outcome: MappingOutcome) => {
	switch (outcome.kind) {
		case "conflict":
		case "ok":
		case "pending": {
			return outcome.body;
		}
		case "malformed":
		case "unknown": {
			return;
		}
	}
};

type CatalogResolve = (
	profile: Profile,
	rawId: string,
) => Promisable<MappingOutcome>;

const remapPreview = async (
	preview: MetaItemPreview,
	profile: Profile,
	resolve: CatalogResolve,
): Promise<MetaItemPreview> => {
	try {
		const body = mappingBodyOf(await resolve(profile, preview.id));
		if (body === undefined) {
			return preview;
		}
		const imdbId = imdbTitleIdFromMapping(body);
		if (imdbId === undefined) {
			return preview;
		}
		return { ...preview, id: imdbId };
	} catch {
		return preview;
	}
};

const catalogPreviews = async (
	hits: readonly CatalogueSearchHit[],
	type: ContentType,
	mediaKind: MediaKind,
	resolve: CatalogResolve,
): Promise<MetaItemPreview[]> => {
	const profile = profileForMediaKind(mediaKind);
	const previews = previewsFromHits(hits, type);
	return Promise.all(
		previews.map(async (preview) => remapPreview(preview, profile, resolve)),
	);
};

const searchQueryOf = (extra: URLSearchParams): string =>
	extra.get(ExtraTypes.SEARCH)?.trim() ?? "";

const CATALOG_PAGE_SIZE = 20;

const skipOf = (extra: URLSearchParams): number => {
	const raw = extra.get(ExtraTypes.SKIP);
	if (raw === null || raw === "") {
		return 0;
	}
	const skip = Number(raw);
	return Number.isFinite(skip) && skip > 0 ? skip : 0;
};

const pageHits = (
	hits: readonly CatalogueSearchHit[],
	extra: URLSearchParams,
): readonly CatalogueSearchHit[] => {
	const skip = skipOf(extra);
	return hits.slice(skip, skip + CATALOG_PAGE_SIZE);
};

export {
	catalogPreviews,
	CATALOG_PAGE_SIZE,
	mediaKindForCatalog,
	pageHits,
	previewsFromHits,
	searchQueryOf,
	skipOf,
};
