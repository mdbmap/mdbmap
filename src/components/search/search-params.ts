import type { MediaKind } from "@/engine";

interface CatalogueSearch {
	mediaKind?: MediaKind | undefined;
	query?: string | undefined;
}

const isMediaKind = (value: unknown): value is MediaKind =>
	value === "anime" || value === "film" || value === "tv";

const parseCatalogueSearch = (
	search: Record<string, unknown>,
): CatalogueSearch => {
	const next: CatalogueSearch = {};
	const queryText = search["query"];
	if (typeof queryText === "string" && queryText.length > 0) {
		next.query = queryText;
	}
	const kind = search["mediaKind"];
	if (isMediaKind(kind)) {
		next.mediaKind = kind;
	}
	return next;
};

export { parseCatalogueSearch, type CatalogueSearch };
