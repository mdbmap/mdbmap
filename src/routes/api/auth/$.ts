import { createFileRoute } from "@tanstack/react-router";

import { resolveAuth } from "@/lib/auth";

export const Route = createFileRoute("/api/auth/$")({
	server: {
		handlers: {
			GET: async ({ request }) => {
				const auth = await resolveAuth();
				return auth.handler(request);
			},
			POST: async ({ request }) => {
				const auth = await resolveAuth();
				return auth.handler(request);
			},
		},
	},
});
