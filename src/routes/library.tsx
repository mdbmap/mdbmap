import { createFileRoute, redirect } from "@tanstack/react-router";

import { LibraryRoute } from "@/components/library/library-route";
import { viewerIsSignedIn } from "@/lib/viewer-session";
import { orpc } from "@/orpc/client";

// Sign-in is the AuthDialog on the home page, not a route of its own.
const SIGN_IN_HREF = "/?signin=1";

export const Route = createFileRoute("/library")({
	beforeLoad: async () => {
		if (!(await viewerIsSignedIn())) {
			redirect({ href: SIGN_IN_HREF, throw: true });
		}
	},
	component: LibraryRoute,
	loader: async ({ context }) =>
		context.queryClient.ensureQueryData(orpc.library.list.queryOptions()),
});
