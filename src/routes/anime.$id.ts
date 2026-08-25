import { createFileRoute } from "@tanstack/react-router";

import { runMapping } from "@/engine/gateway";

export const Route = createFileRoute("/anime/$id")({
	server: {
		handlers: {
			GET: async ({ params }) => runMapping("anime", params.id),
		},
	},
});
