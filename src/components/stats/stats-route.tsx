import { useSuspenseQuery } from "@tanstack/react-query";

import { orpc } from "@/orpc/client";

import { StatsPage } from "./stats-page";

export function StatsRoute() {
	const { data } = useSuspenseQuery(
		orpc.library.list.queryOptions({ input: {} }),
	);
	return <StatsPage entries={data} />;
}
