import { createFileRoute, redirect } from "@tanstack/react-router";

import { StatsRoute } from "@/components/stats/stats-route";
import { viewerIsSignedIn } from "@/lib/viewer-session";
import { orpc } from "@/orpc/client";

const SIGN_IN_HREF = "/?signin=1";

export const Route = createFileRoute("/stats")({
	beforeLoad: async () => {
		if (!(await viewerIsSignedIn())) {
			redirect({ href: SIGN_IN_HREF, throw: true });
		}
	},
	component: StatsRoute,
	loader: async ({ context }) =>
		context.queryClient.ensureQueryData(orpc.library.list.queryOptions()),
});
