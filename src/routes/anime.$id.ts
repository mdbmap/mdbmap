import { createFileRoute } from "@tanstack/react-router";

import { publicMappingHandler } from "@/engine/gateway";

export const Route = createFileRoute("/anime/$id")({
	server: {
		handlers: {
			GET: publicMappingHandler("anime"),
		},
	},
});
