import type { ContentType, MetaItem, MetaItemPreview } from "stremio-types";
import type { Promisable } from "type-fest";

import type { MediaKind } from "@/engine";
import type { MappingOutcome } from "@/engine/gateway";
import type { Profile } from "@/engine/identity.ts";
import type { CatalogueSearchHit, WorkMetadata } from "@/orpc/providers";

import {
	catalogPreviews,
	mediaKindForCatalog,
	pageHits,
	searchQueryOf,
} from "./catalog.ts";
import { addonManifest } from "./manifest.ts";
import { applyDisplay, metaFromOutcome, profileFor } from "./meta.ts";
import { parseAddonPath } from "./protocol.ts";

interface AddonDeps {
	readonly display?: (
		continuityId: number,
	) => Promisable<WorkMetadata | undefined>;
	readonly resolve: (
		profile: Profile,
		rawId: string,
	) => Promisable<MappingOutcome>;
	readonly search: (
		query: string,
		mediaKind: MediaKind,
	) => Promisable<readonly CatalogueSearchHit[]>;
}

const corsHeaders = {
	"access-control-allow-headers": "*",
	"access-control-allow-methods": "GET,HEAD,OPTIONS",
	"access-control-allow-origin": "*",
};

const CACHE_HOUR = 3600;
const CACHE_NONE = 0;

const jsonResponse = (
	body: unknown,
	status: number,
	cacheMaxAge: number,
): Response =>
	Response.json(body, {
		headers: {
			...corsHeaders,
			"cache-control": `public, max-age=${String(cacheMaxAge)}`,
		},
		status,
	});

const notFound = (): Response =>
	jsonResponse({ error: "not found" }, 404, CACHE_NONE);

const stremioOptionsResponse = (): Response =>
	new Response(undefined, { headers: corsHeaders, status: 204 });

const cacheForOutcome = (outcome: MappingOutcome): number =>
	outcome.kind === "ok" ? CACHE_HOUR : CACHE_NONE;

const continuityIdOf = (outcome: MappingOutcome): number | undefined => {
	switch (outcome.kind) {
		case "conflict":
		case "ok":
		case "pending": {
			return outcome.body.continuityId;
		}
		case "malformed":
		case "unknown": {
			return undefined;
		}
	}
};

const displayedMeta = async (
	meta: MetaItem,
	outcome: MappingOutcome,
	display: AddonDeps["display"],
): Promise<MetaItem> => {
	if (display === undefined) {
		return meta;
	}
	const continuityId = continuityIdOf(outcome);
	if (continuityId === undefined) {
		return meta;
	}
	try {
		const work = await display(continuityId);
		if (work === undefined) {
			return meta;
		}
		return applyDisplay(meta, work);
	} catch {
		return meta;
	}
};

const catalogMetas = async (
	deps: AddonDeps,
	catalogId: string,
	type: ContentType,
	extra: URLSearchParams,
): Promise<MetaItemPreview[] | undefined> => {
	const mediaKind = mediaKindForCatalog(catalogId);
	const query = searchQueryOf(extra);
	if (mediaKind === undefined || query === "") {
		return [];
	}
	try {
		const hits = await deps.search(query, mediaKind);
		return await catalogPreviews(
			pageHits(hits, extra),
			type,
			mediaKind,
			deps.resolve,
		);
	} catch {
		return undefined;
	}
};

const handleStremioRequest = async (
	request: Request,
	deps: AddonDeps,
): Promise<Response> => {
	const parsed = parseAddonPath(new URL(request.url).pathname);
	if (parsed === undefined) {
		return notFound();
	}
	if (parsed.kind === "manifest") {
		return jsonResponse(addonManifest, 200, CACHE_HOUR);
	}
	if (parsed.kind === "catalog") {
		const metas = await catalogMetas(
			deps,
			parsed.id,
			parsed.type,
			parsed.extra,
		);
		if (metas === undefined) {
			return jsonResponse(
				{ cacheMaxAge: CACHE_NONE, metas: [] },
				200,
				CACHE_NONE,
			);
		}
		return jsonResponse({ cacheMaxAge: CACHE_HOUR, metas }, 200, CACHE_HOUR);
	}
	const profile = profileFor(parsed.type, parsed.id);
	if (profile === undefined) {
		return notFound();
	}
	const outcome = await deps.resolve(profile, parsed.id);
	const mapped = metaFromOutcome(outcome, parsed.type, parsed.id);
	if (mapped === undefined) {
		return notFound();
	}
	const meta = await displayedMeta(mapped, outcome, deps.display);
	const cacheMaxAge = cacheForOutcome(outcome);
	return jsonResponse({ cacheMaxAge, meta }, 200, cacheMaxAge);
};

export { handleStremioRequest, stremioOptionsResponse };
export type { AddonDeps };
