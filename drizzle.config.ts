import { config } from "dotenv";
import { defineConfig } from "drizzle-kit";
import type { Config } from "drizzle-kit";
import stripUndefined from "strip-undefined";

config({ path: [".env.local", ".env"] });

export default defineConfig(
	stripUndefined<Config>({
		dbCredentials: {
			url: process.env.DATABASE_URL,
		},
		dialect: "sqlite",
		out: "./schemas/drizzle",
		schema: "./src/db/schema.ts",
	}),
);
