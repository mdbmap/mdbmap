import { ORPCError, os } from "@orpc/server";

import { db as defaultDb } from "@/db";
import { createEngine } from "@/engine";
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
		return { id: result.user.id };
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
	const db = context.db ?? fallbackDb;
	return next({
		context: {
			db,
			engine: context.engine ?? createEngine(db),
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

export { authed, pub };
