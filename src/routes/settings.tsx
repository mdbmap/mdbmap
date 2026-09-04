import { createFileRoute, redirect } from "@tanstack/react-router";

import { SettingsRoute } from "@/components/settings/settings-route";
import { viewerIsSignedIn } from "@/lib/viewer-session";
import { orpc } from "@/orpc/client";

const SIGN_IN_HREF = "/?signin=1";

export const Route = createFileRoute("/settings")({
	beforeLoad: async () => {
		if (!(await viewerIsSignedIn())) {
			redirect({ href: SIGN_IN_HREF, throw: true });
		}
	},
	component: SettingsRoute,
	loader: async ({ context }) =>
		context.queryClient.ensureQueryData(orpc.library.list.queryOptions()),
});
