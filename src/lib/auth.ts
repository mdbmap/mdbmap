import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { admin } from "better-auth/plugins";
import { tanstackStartCookies } from "better-auth/tanstack-start";

import { resolveDb } from "@/db";
import { account, session, user, verification } from "@/db/schema";

// Built per request so the D1 db is resolved from the Workers env, mirroring
// `resolveDb`. Construction runs no query, so rebuilding per call is cheap.
const resolveAuth = async () => {
	const db = await resolveDb();
	return betterAuth({
		database: drizzleAdapter(db, {
			provider: "sqlite",
			schema: { account, session, user, verification },
		}),
		emailAndPassword: {
			enabled: true,
		},
		plugins: [admin(), tanstackStartCookies()],
	});
};

export { resolveAuth };
