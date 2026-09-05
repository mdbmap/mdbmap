/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { applyD1Migrations } from "cloudflare:test";
import type { D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll } from "vitest";

declare global {
	interface __BaseEnv_Env {
		TEST_MIGRATIONS: D1Migration[];
	}
}

beforeAll(async () => {
	await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
});
