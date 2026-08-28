import { useSuspenseQuery } from "@tanstack/react-query";
import { useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useCallback } from "react";

import { workGetInput } from "@/components/work/part-state";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import { presentationOrderSlugs } from "@/db/engine-schema";
import { continuityKey } from "@/engine/continuity/keys";
import { orpc } from "@/orpc/client";

import { WorkPage } from "./work-page";

export function WorkRoute() {
	const { continuityId } = useParams({ from: "/work/$continuityId" });
	const { order } = useSearch({ from: "/work/$continuityId" });
	const navigate = useNavigate({ from: "/work/$continuityId" });
	const input = workGetInput(continuityKey(continuityId), order);
	const query = orpc.work.get.queryOptions({ input });
	const { data } = useSuspenseQuery(query);
	const onSelectOrder = useCallback(
		(next: PresentationOrderSlug) => {
			void navigate({ search: { order: next } });
		},
		[navigate],
	);
	return (
		<WorkPage
			onSelectOrder={onSelectOrder}
			order={order}
			orders={presentationOrderSlugs}
			work={data}
		/>
	);
}
