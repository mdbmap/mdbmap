import { ORPCError, os } from "@orpc/server";

import { resolveDb } from "@/db";
import { createEngine } from "@/engine";
import { resolveAuth } from "@/lib/auth";

import type { ORPCContext, ResolveSession } from "./context.ts";
import { defaultProviders } from "./providers";

const resolveViaBetterAuth: ResolveSession = async (headers) => {
	if (headers === undefined) {
		return;
	}
	try {
		const auth = await resolveAuth();
		const result = await auth.api.getSession({ headers });
		if (!result) {
			return;
		}
		const role = result.user.role ?? undefined;
		return role === undefined
			? { id: result.user.id }
			: { id: result.user.id, role };
	} catch {
		// An unavailable auth resolver degrades to unauthenticated rather than
		// throwing, so a render is never blocked by the session lookup.
		return;
	}
};

const base = os.$context<ORPCContext>();

const pub = base.use(async ({ context, next }) => {
	const resolve = context.resolveSession ?? resolveViaBetterAuth;
	const user = await resolve(context.headers);
	const db = context.db ?? (await resolveDb());
	return next({
		context: {
			db,
			engine: context.engine ?? createEngine(db),
			providers: context.providers ?? defaultProviders,
			user,
		},
	});
});

const authed = pub.use(async ({ context, next }) => {
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
	role !== undefined &&
	role.split(",").some((entry) => entry.trim() === ADMIN_ROLE);

const admin = authed.use(({ context, next }) => {
	if (!hasAdminRole(context.user.role)) {
		throw new ORPCError("FORBIDDEN", {
			message: "Administrator access required.",
		});
	}
	return next({ context: { user: context.user } });
});

export { admin, authed, pub };
