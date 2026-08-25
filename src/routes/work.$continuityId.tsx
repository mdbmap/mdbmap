import { createFileRoute } from "@tanstack/react-router";

import { WorkRoute } from "@/components/work/work-route";
import { orpc } from "@/orpc/client";

export const Route = createFileRoute("/work/$continuityId")({
	component: WorkRoute,
	loader: async ({ context, params }) =>
		context.queryClient.ensureQueryData(
			orpc.work.get.queryOptions({ input: { continuityId: params.continuityId } }),
		),
});
