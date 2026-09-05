import { createFileRoute, redirect } from "@tanstack/react-router";

import { HistoryRoute } from "@/components/history/history-route";
import { viewerIsSignedIn } from "@/lib/viewer-session";
import { orpc } from "@/orpc/client";

const SIGN_IN_HREF = "/?signin=1";

export const Route = createFileRoute("/history")({
	beforeLoad: async () => {
		if (!(await viewerIsSignedIn())) {
			redirect({ href: SIGN_IN_HREF, throw: true });
		}
	},
	component: HistoryRoute,
	loader: async ({ context }) =>
		context.queryClient.ensureQueryData(
			orpc.history.list.queryOptions({ input: {} }),
		),
});
