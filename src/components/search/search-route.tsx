import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { orpc } from "@/orpc/client";
import type { SearchHit } from "@/orpc/schema";

import { SearchPage } from "./search-page";
import type { SearchView } from "./search-page";

const DEBOUNCE_MS = 300;

const viewFromQuery = ({
	data,
	hasQuery,
	isError,
	isFetching,
	isPending,
}: {
	data: SearchHit[] | undefined;
	hasQuery: boolean;
	isError: boolean;
	isFetching: boolean;
	isPending: boolean;
}): SearchView => {
	if (!hasQuery) {
		return { kind: "idle" };
	}
	if (isPending || (isFetching && data === undefined)) {
		return { kind: "pending" };
	}
	if (isError) {
		return { kind: "error" };
	}
	const hits = data ?? [];
	if (hits.length === 0) {
		return { kind: "empty" };
	}
	return { hits, kind: "ready" };
};

const useSearchDraft = (urlQuery: string) => {
	const navigate = useNavigate({ from: "/search" });
	const [draft, setDraft] = useState(urlQuery);
	const [seenUrlQuery, setSeenUrlQuery] = useState(urlQuery);

	if (urlQuery !== seenUrlQuery) {
		setSeenUrlQuery(urlQuery);
		setDraft(urlQuery);
	}

	useEffect(() => {
		if (draft === urlQuery) {
			return;
		}
		const handle = globalThis.setTimeout(() => {
			void navigate({
				replace: true,
				search: (previous) => {
					const next = { ...previous };
					const trimmed = draft.trim();
					if (trimmed.length === 0) {
						delete next.query;
					} else {
						next.query = draft;
					}
					return next;
				},
			});
		}, DEBOUNCE_MS);
		return () => {
			globalThis.clearTimeout(handle);
		};
	}, [draft, navigate, urlQuery]);

	return { draft, setDraft };
};

export function SearchRoute() {
	const search = useSearch({ from: "/search" });
	const urlQuery = search.query ?? "";
	const { draft, setDraft } = useSearchDraft(urlQuery);
	const trimmed = urlQuery.trim();
	const hasQuery = trimmed.length > 0;
	const input =
		search.mediaKind === undefined
			? { query: trimmed }
			: { mediaKind: search.mediaKind, query: trimmed };
	const query = useQuery({
		...orpc.search.query.queryOptions({ input }),
		enabled: hasQuery,
	});

	return (
		<SearchPage
			draft={draft}
			onDraftChange={setDraft}
			view={viewFromQuery({
				data: query.data,
				hasQuery,
				isError: query.isError,
				isFetching: query.isFetching,
				isPending: query.isPending,
			})}
		/>
	);
}
