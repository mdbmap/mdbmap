import { createFileRoute } from "@tanstack/react-router";

import { publicMappingHandler } from "@/engine/gateway";

export const Route = createFileRoute("/series/$id")({
	server: {
		handlers: {
			GET: publicMappingHandler("series"),
		},
	},
});
