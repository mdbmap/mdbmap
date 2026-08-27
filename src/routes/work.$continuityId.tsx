import { createFileRoute } from "@tanstack/react-router";

import { workGetInput } from "@/components/work/part-state";
import { WorkRoute } from "@/components/work/work-route";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import { orpc } from "@/orpc/client";

const isOrder = (value: unknown): value is PresentationOrderSlug =>
	value === "release" || value === "watch";

interface WorkSearch {
	order?: PresentationOrderSlug | undefined;
}

export const Route = createFileRoute("/work/$continuityId")({
	component: WorkRoute,
	loader: async ({ context, deps, params }) =>
		context.queryClient.ensureQueryData(
			orpc.work.get.queryOptions({
				input: workGetInput(params.continuityId, deps.order),
			}),
		),
	loaderDeps: (opts: { search: WorkSearch }): WorkSearch => ({
		order: opts.search.order,
	}),
	validateSearch: (search: Record<string, unknown>): WorkSearch => {
		const { order } = search;
		return isOrder(order) ? { order } : {};
	},
});
