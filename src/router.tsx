import { createRouter as createTanStackRouter } from "@tanstack/react-router";
import { setupRouterSsrQueryIntegration } from "@tanstack/react-router-ssr-query";

import { routeTree } from "#/routeTree";

import { getContext } from "./integrations/tanstack-query/root-provider";

declare module "@tanstack/react-router" {
	interface Register {
		router: ReturnType<typeof getRouter>;
	}
}

export function getRouter() {
	const context = getContext(),
		router = createTanStackRouter({
			context,
			defaultPreload: "intent",
			defaultPreloadStaleTime: 0,
			routeTree,
			scrollRestoration: true,
		});

	setupRouterSsrQueryIntegration({ queryClient: context.queryClient, router });

	return router;
}
