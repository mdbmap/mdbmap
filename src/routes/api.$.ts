import { SmartCoercionPlugin } from "@orpc/json-schema";
import { OpenAPIHandler } from "@orpc/openapi/fetch";
import { OpenAPIReferencePlugin } from "@orpc/openapi/plugins";
import { onError } from "@orpc/server";
import { ZodToJsonSchemaConverter } from "@orpc/zod/zod4";
import { createFileRoute } from "@tanstack/react-router";

import { router } from "@/orpc/router";
import { TodoSchema } from "@/orpc/schema";

const handler = new OpenAPIHandler(router, {
	interceptors: [
		onError((caught) => {
			console.error(caught);
		}),
	],
	plugins: [
		new SmartCoercionPlugin({
			schemaConverters: [new ZodToJsonSchemaConverter()],
		}),
		new OpenAPIReferencePlugin({
			docsConfig: {
				authentication: {
					securitySchemes: {
						bearerAuth: {
							token: "default-token",
						},
					},
				},
			},
			schemaConverters: [new ZodToJsonSchemaConverter()],
			specGenerateOptions: {
				commonSchemas: {
					Todo: { schema: TodoSchema },
					UndefinedError: { error: "UndefinedError" },
				},
				components: {
					securitySchemes: {
						bearerAuth: {
							scheme: "bearer",
							type: "http",
						},
					},
				},
				info: {
					title: "TanStack ORPC Playground",
					version: "1.0.0",
				},
				security: [{ bearerAuth: [] }],
			},
		}),
	],
});

async function handle({ request }: { request: Request }) {
	const { response } = await handler.handle(request, {
		context: {},
		prefix: "/api",
	});

	return response ?? new Response("Not Found", { status: 404 });
}

export const Route = createFileRoute("/api/$")({
	server: {
		handlers: {
			DELETE: handle,
			GET: handle,
			HEAD: handle,
			PATCH: handle,
			POST: handle,
			PUT: handle,
		},
	},
});
