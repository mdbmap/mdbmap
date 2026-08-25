import { createFileRoute } from "@tanstack/react-router";

import { runMapping } from "@/engine/gateway";

export const Route = createFileRoute("/series/$id")({
	server: {
		handlers: {
			GET: async ({ params }) => runMapping("series", params.id),
		},
	},
});
