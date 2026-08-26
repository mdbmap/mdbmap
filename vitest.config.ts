import {
	cloudflareTest,
	readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { defineConfig } from "vitest/config";

const root = import.meta.dirname;
const src = `${root}/src`;

export default defineConfig({
	plugins: [
		tanstackStart({
			router: { generatedRouteTree: "generated/routeTree.ts" },
		}),
		cloudflareTest(async () => ({
			miniflare: {
				bindings: {
					TEST_MIGRATIONS: await readD1Migrations(`${root}/schemas/drizzle`),
				},
				compatibilityDate: "2025-09-02",
				compatibilityFlags: ["nodejs_compat"],
				d1Databases: ["DB"],
				kvNamespaces: ["METADATA_KV"],
				ratelimits: {
					API_RATE_LIMIT: {
						namespace_id: "1001",
						simple: { limit: 60, period: 60 },
					},
				},
			},
		})),
	],
	resolve: {
		alias: {
			"#": `${src}/generated`,
			"@": src,
		},
	},
	test: {
		coverage: {
			provider: "v8",
		},
		// cloudflare/workers-sdk#14736: the workers pool double-reports handled rejections
		dangerouslyIgnoreUnhandledErrors: true,
		passWithNoTests: true,
		setupFiles: ["./src/db/test-setup.ts"],
	},
});
