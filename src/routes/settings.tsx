import { createFileRoute, redirect } from "@tanstack/react-router";

import { SettingsRoute } from "@/components/settings/settings-route";
import { viewerIsSignedIn } from "@/lib/viewer-session";
import { orpc } from "@/orpc/client";

// Sign-in is the AuthDialog on the home page, not a route of its own.
const SIGN_IN_HREF = "/?signin=1";
const LIBRARY_LIST_INPUT = {};

export const Route = createFileRoute("/settings")({
	beforeLoad: async () => {
		if (!(await viewerIsSignedIn())) {
			redirect({ href: SIGN_IN_HREF, throw: true });
		}
	},
	component: SettingsRoute,
	loader: async ({ context }) => {
		await Promise.all([
			context.queryClient.ensureQueryData(
				orpc.library.list.queryOptions({ input: LIBRARY_LIST_INPUT }),
			),
			context.queryClient.ensureQueryData(orpc.billing.status.queryOptions()),
		]);
	},
});
