import { ORPCError, os } from "@orpc/server";

import { db as defaultDb } from "@/db";
import { stubEngine } from "@/engine";
import { auth } from "@/lib/auth";

import type { Db, ORPCContext, ResolveSession } from "./context.ts";
import { defaultProviders } from "./providers";

const fallbackDb: Db = defaultDb;

const resolveViaBetterAuth: ResolveSession = async (headers) => {
	if (headers === undefined) {
		return;
	}
	try {
		const result = await auth.api.getSession({ headers });
		if (!result) {
			return;
		}
		const role = result.user.role ?? undefined;
		return role === undefined ? { id: result.user.id } : { id: result.user.id, role };
	} catch {
		// Auth is not yet wired to D1 (auth flows are outside this epic); an
		// unavailable resolver degrades to unauthenticated rather than throwing.
		return;
	}
};

const base = os.$context<ORPCContext>();

const pub = base.use(async ({ context, next }) => {
	const resolve = context.resolveSession ?? resolveViaBetterAuth;
	const user = await resolve(context.headers);
	return next({
		context: {
			db: context.db ?? fallbackDb,
			engine: context.engine ?? stubEngine,
			providers: context.providers ?? defaultProviders,
			user,
		},
	});
});

const authed = pub.use(({ context, next }) => {
	if (context.user === undefined) {
		throw new ORPCError("UNAUTHORIZED", {
			message: "Sign in to track your progress.",
		});
	}
	return next({ context: { user: context.user } });
});

const ADMIN_ROLE = "admin";

// Better-Auth stores roles as a comma-separated string; the moderation surface
// admits any user carrying the `admin` role.
const hasAdminRole = (role: string | undefined): boolean =>
	role !== undefined && role.split(",").some((entry) => entry.trim() === ADMIN_ROLE);

const admin = authed.use(({ context, next }) => {
	if (!hasAdminRole(context.user.role)) {
		throw new ORPCError("FORBIDDEN", {
			message: "Moderation is limited to administrators.",
		});
	}
	return next({ context: { user: context.user } });
});

export { admin, authed, pub };
