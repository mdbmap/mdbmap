import { createFileRoute } from "@tanstack/react-router";

import { runMapping } from "@/engine/gateway";
import { withPublicApiGate } from "@/lib/api-key";

export const Route = createFileRoute("/series/$id")({
	server: {
		handlers: {
			GET: async ({ params, request }) =>
				withPublicApiGate(request, async () => runMapping("series", params.id)),
		},
	},
});
