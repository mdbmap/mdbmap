import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";

import type { WatchStatus } from "@/db/schema";
import type { MediaKind } from "@/engine";
import { orpc } from "@/orpc/client";
import type { LibrarySort } from "@/orpc/schema";

import { LibraryPage } from "./library-page";
import { libraryListInput } from "./library-params";
import type { LibrarySearch } from "./library-params";

const QUERY_DEBOUNCE_MS = 300;

const withStatus =
	(status: WatchStatus | undefined) =>
	(previous: LibrarySearch): LibrarySearch => {
		const next = { ...previous };
		if (status === undefined) {
			delete next.status;
		} else {
			next.status = status;
		}
		return next;
	};

const withSort =
	(sort: LibrarySort) =>
	(previous: LibrarySearch): LibrarySearch => {
		const next = { ...previous };
		if (sort === "activity") {
			delete next.sort;
		} else {
			next.sort = sort;
		}
		return next;
	};

const withQuery =
	(query: string) =>
	(previous: LibrarySearch): LibrarySearch => {
		const next = { ...previous };
		if (query.trim().length === 0) {
			delete next.q;
		} else {
			next.q = query;
		}
		return next;
	};

const withKind =
	(kind: MediaKind | undefined) =>
	(previous: LibrarySearch): LibrarySearch => {
		const next = { ...previous };
		if (kind === undefined) {
			delete next.kind;
		} else {
			next.kind = kind;
		}
		return next;
	};

const useLibraryQueryDraft = (urlQuery: string) => {
	const navigate = useNavigate({ from: "/library" });
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
			void navigate({ replace: true, search: withQuery(draft) });
		}, QUERY_DEBOUNCE_MS);
		return () => {
			globalThis.clearTimeout(handle);
		};
	}, [draft, navigate, urlQuery]);

	return { draft, setDraft };
};

export function LibraryRoute() {
	const search = useSearch({ from: "/library" });
	const navigate = useNavigate({ from: "/library" });
	const urlQuery = search.q ?? "";
	const { draft, setDraft } = useLibraryQueryDraft(urlQuery);
	const { data } = useSuspenseQuery(
		orpc.library.list.queryOptions({ input: libraryListInput(search) }),
	);

	const onStatusChange = useCallback(
		(status: WatchStatus | undefined) => {
			void navigate({ replace: true, search: withStatus(status) });
		},
		[navigate],
	);

	const onSortChange = useCallback(
		(sort: LibrarySort) => {
			void navigate({ replace: true, search: withSort(sort) });
		},
		[navigate],
	);

	const onKindChange = useCallback(
		(kind: MediaKind | undefined) => {
			void navigate({ replace: true, search: withKind(kind) });
		},
		[navigate],
	);

	return (
		<LibraryPage
			entries={data}
			kind={search.kind}
			onKindChange={onKindChange}
			onQueryChange={setDraft}
			onSortChange={onSortChange}
			onStatusChange={onStatusChange}
			query={draft}
			sort={search.sort ?? "activity"}
			status={search.status}
		/>
	);
}
