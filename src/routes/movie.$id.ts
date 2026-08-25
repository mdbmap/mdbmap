import { createFileRoute } from "@tanstack/react-router";

import { runMapping } from "@/engine/gateway";

export const Route = createFileRoute("/movie/$id")({
	server: {
		handlers: {
			GET: async ({ params }) => runMapping("movie", params.id),
		},
	},
});
