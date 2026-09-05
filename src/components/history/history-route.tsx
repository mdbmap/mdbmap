import { useMutation, useSuspenseQuery } from "@tanstack/react-query";
import { useCallback, useMemo, useState } from "react";

import { client, orpc } from "@/orpc/client";
import type { HistoryEntry, HistoryListCursor } from "@/orpc/schema";

import { HistoryPage } from "./history-page";

function HistoryRoute() {
	const { data } = useSuspenseQuery(
		orpc.history.list.queryOptions({ input: {} }),
	);
	const [extra, setExtra] = useState<readonly HistoryEntry[]>([]);
	const [cursor, setCursor] = useState<HistoryListCursor | undefined>();
	const [paged, setPaged] = useState(false);
	const loadMore = useMutation({
		mutationFn: async (pageCursor: HistoryListCursor) =>
			client.history.list({ cursor: pageCursor }),
	});
	const nextCursor = paged ? cursor : data.nextCursor;
	const entries = useMemo(
		() => [...data.entries, ...extra],
		[data.entries, extra],
	);
	const { isPending, mutate } = loadMore;
	const onLoadMore = useCallback(() => {
		if (nextCursor === undefined || isPending) {
			return;
		}
		mutate(nextCursor, {
			onSuccess: (page) => {
				setExtra((current) => [...current, ...page.entries]);
				setCursor(page.nextCursor);
				setPaged(true);
			},
		});
	}, [isPending, mutate, nextCursor]);
	return (
		<HistoryPage
			entries={entries}
			loadingMore={isPending}
			nextCursor={nextCursor}
			onLoadMore={onLoadMore}
		/>
	);
}

export { HistoryRoute };
