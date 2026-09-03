import { createServerFn } from "@tanstack/react-start";
import { getRequestHeaders } from "@tanstack/react-start/server";

import { resolveAuth } from "./auth.ts";

// Mirrors `resolveViaBetterAuth` in the oRPC base: an unavailable auth resolver
// reads as signed out rather than throwing, and the authed procedure behind the
// route stays the real gate.
const viewerIsSignedIn = createServerFn({ method: "GET" }).handler(async () => {
	try {
		const auth = await resolveAuth();
		const session = await auth.api.getSession({ headers: getRequestHeaders() });
		return Boolean(session);
	} catch {
		return false;
	}
});

export { viewerIsSignedIn };
