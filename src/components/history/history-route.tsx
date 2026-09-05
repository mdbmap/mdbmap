import { useSuspenseQuery } from "@tanstack/react-query";

import { orpc } from "@/orpc/client";

import { HistoryPage } from "./history-page";

function HistoryRoute() {
	const { data } = useSuspenseQuery(
		orpc.history.list.queryOptions({ input: {} }),
	);
	return <HistoryPage entries={data.entries} />;
}

export { HistoryRoute };
