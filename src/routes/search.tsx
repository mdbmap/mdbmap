import { createFileRoute } from "@tanstack/react-router";

import { parseCatalogueSearch } from "@/components/search/search-params";
import type { CatalogueSearch } from "@/components/search/search-params";
import { SearchRoute } from "@/components/search/search-route";
import { orpc } from "@/orpc/client";

const searchLoaderDeps = (opts: {
	search: CatalogueSearch;
}): CatalogueSearch => ({
	mediaKind: opts.search.mediaKind,
	query: opts.search.query,
});

export const Route = createFileRoute("/search")({
	component: SearchRoute,
	loader: async ({ context, deps }) => {
		const trimmed = deps.query?.trim() ?? "";
		if (trimmed.length === 0) {
			return;
		}
		const input =
			deps.mediaKind === undefined
				? { query: trimmed }
				: { mediaKind: deps.mediaKind, query: trimmed };
		await context.queryClient.ensureQueryData(
			orpc.search.query.queryOptions({ input }),
		);
	},
	loaderDeps: searchLoaderDeps,
	validateSearch: parseCatalogueSearch,
});
