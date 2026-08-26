import { createFileRoute } from "@tanstack/react-router";

import { runMapping } from "@/engine/gateway";
import { withPublicApiGate } from "@/lib/api-key";

export const Route = createFileRoute("/movie/$id")({
	server: {
		handlers: {
			GET: async ({ params, request }) =>
				withPublicApiGate(request, async () => runMapping("movie", params.id)),
		},
	},
});
