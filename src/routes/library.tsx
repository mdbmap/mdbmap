import { createFileRoute, redirect } from "@tanstack/react-router";

import {
	libraryListInput,
	parseLibrarySearch,
} from "@/components/library/library-params";
import type { LibrarySearch } from "@/components/library/library-params";
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
	loader: async ({ context, deps }) =>
		context.queryClient.ensureQueryData(
			orpc.library.list.queryOptions({ input: deps }),
		),
	loaderDeps: ({ search }: { search: LibrarySearch }) =>
		libraryListInput(search),
	validateSearch: parseLibrarySearch,
});
