import { useSuspenseQuery } from "@tanstack/react-query";
import { useParams } from "@tanstack/react-router";

import { orpc } from "@/orpc/client";

import { WorkPage } from "./work-page";

export function WorkRoute() {
	const { continuityId } = useParams({ from: "/work/$continuityId" });
	const { data } = useSuspenseQuery(
		orpc.work.get.queryOptions({ input: { continuityId } }),
	);
	return <WorkPage work={data} />;
}
