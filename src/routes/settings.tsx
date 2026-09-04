import { createFileRoute, redirect } from "@tanstack/react-router";

import { SettingsPage } from "@/components/settings/settings-page";
import { viewerIsSignedIn } from "@/lib/viewer-session";
import { orpc } from "@/orpc/client";

// Sign-in is the AuthDialog on the home page, not a route of its own.
const SIGN_IN_HREF = "/?signin=1";

export const Route = createFileRoute("/settings")({
	beforeLoad: async () => {
		if (!(await viewerIsSignedIn())) {
			redirect({ href: SIGN_IN_HREF, throw: true });
		}
	},
	component: SettingsPage,
	loader: async ({ context }) =>
		context.queryClient.ensureQueryData(orpc.billing.status.queryOptions()),
});
