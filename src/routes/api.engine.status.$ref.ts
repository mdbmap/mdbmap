import { createFileRoute } from "@tanstack/react-router";

import { runIngestStatus } from "@/engine/gateway";
import { withPublicApiGate } from "@/lib/api-key";

export const Route = createFileRoute("/api/engine/status/$ref")({
	server: {
		handlers: {
			GET: async ({ params, request }) =>
				withPublicApiGate(request, async () => runIngestStatus(params.ref)),
		},
	},
});
