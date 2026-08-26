import { createFileRoute } from "@tanstack/react-router";

import { publicMappingHandler } from "@/engine/gateway";

export const Route = createFileRoute("/movie/$id")({
	server: {
		handlers: {
			GET: publicMappingHandler("movie"),
		},
	},
});
