import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

import type { WatchStatus } from "@/db/schema";
import { orpc } from "@/orpc/client";
import type { LibrarySort } from "@/orpc/schema";

import { LibraryPage } from "./library-page";
import { libraryListInput } from "./library-params";
import type { LibrarySearch } from "./library-params";

export function LibraryRoute() {
	const search = useSearch({ from: "/library" });
	const navigate = useNavigate({ from: "/library" });
	const { data } = useSuspenseQuery(
		orpc.library.list.queryOptions({ input: libraryListInput(search) }),
	);

	const onStatusChange = useCallback(
		(status: WatchStatus | undefined) => {
			void navigate({
				replace: true,
				search: (previous: LibrarySearch) => {
					const next = { ...previous };
					if (status === undefined) {
						delete next.status;
					} else {
						next.status = status;
					}
					return next;
				},
			});
		},
		[navigate],
	);

	const onSortChange = useCallback(
		(sort: LibrarySort) => {
			void navigate({
				replace: true,
				search: (previous: LibrarySearch) => {
					const next = { ...previous };
					if (sort === "activity") {
						delete next.sort;
					} else {
						next.sort = sort;
					}
					return next;
				},
			});
		},
		[navigate],
	);

	return (
		<LibraryPage
			entries={data}
			onSortChange={onSortChange}
			onStatusChange={onStatusChange}
			sort={search.sort ?? "activity"}
			status={search.status}
		/>
	);
}
