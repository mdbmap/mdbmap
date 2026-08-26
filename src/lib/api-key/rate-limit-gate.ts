import type { Db } from "@/db";
import { resolveDb } from "@/db";
import type { ApiKeyPlan } from "@/db/schema";

import { verifyApiKey } from "./verify.ts";

const RETRY_AFTER_SECONDS = 60;

// ADR-0006: paid-tier bindings deferred — every plan uses the free binding for now.
const API_RATE_LIMIT_BINDING_BY_PLAN = {
	free: "API_RATE_LIMIT",
	pro: "API_RATE_LIMIT",
} as const satisfies Record<ApiKeyPlan, "API_RATE_LIMIT">;

type ApiRateLimitBindingName =
	(typeof API_RATE_LIMIT_BINDING_BY_PLAN)[ApiKeyPlan];

type ApiRateLimitBindings = Readonly<Record<ApiKeyPlan, RateLimit>>;

interface ApiKeyRateLimitGateDeps {
	readonly db?: Db | undefined;
	readonly rateLimits?: ApiRateLimitBindings | undefined;
}

const unauthorizedResponse = (): Response =>
	Response.json({ error: "Unauthorized" }, { status: 401 });

const tooManyRequestsResponse = (): Response =>
	Response.json(
		{ error: "Too Many Requests", retryAfter: RETRY_AFTER_SECONDS },
		{
			headers: { "retry-after": String(RETRY_AFTER_SECONDS) },
			status: 429,
		},
	);

const extractBearerSecret = (request: Request): string | undefined => {
	const header = request.headers.get("authorization");
	if (header === null) {
		return undefined;
	}
	const match = /^Bearer\s+(?<secret>\S+)$/iu.exec(header.trim());
	return match?.groups?.["secret"];
};

const resolveApiRateLimits = (
	env: Pick<Env, ApiRateLimitBindingName>,
): ApiRateLimitBindings => ({
	free: env[API_RATE_LIMIT_BINDING_BY_PLAN.free],
	pro: env[API_RATE_LIMIT_BINDING_BY_PLAN.pro],
});

const resolveRateLimits = async (
	rateLimits: ApiRateLimitBindings | undefined,
): Promise<ApiRateLimitBindings> => {
	if (rateLimits !== undefined) {
		return rateLimits;
	}
	const { env } = await import("cloudflare:workers");
	return resolveApiRateLimits(env);
};

const enforceApiKeyRateLimit = async (
	request: Request,
	deps: ApiKeyRateLimitGateDeps = {},
): Promise<Response | undefined> => {
	const secret = extractBearerSecret(request);
	if (secret === undefined) {
		return unauthorizedResponse();
	}

	const db = deps.db ?? (await resolveDb());
	const verified = await verifyApiKey(db, secret);
	if (verified === undefined) {
		return unauthorizedResponse();
	}

	const rateLimits = await resolveRateLimits(deps.rateLimits);
	const limiter = rateLimits[verified.plan];
	const { success } = await limiter.limit({ key: verified.id });
	if (!success) {
		return tooManyRequestsResponse();
	}
	return undefined;
};

const withPublicApiGate = async (
	request: Request,
	next: () => Promise<Response>,
	deps: ApiKeyRateLimitGateDeps = {},
): Promise<Response> => {
	const denial = await enforceApiKeyRateLimit(request, deps);
	if (denial !== undefined) {
		return denial;
	}
	return next();
};

export {
	API_RATE_LIMIT_BINDING_BY_PLAN,
	enforceApiKeyRateLimit,
	resolveApiRateLimits,
	RETRY_AFTER_SECONDS,
	withPublicApiGate,
};
export type { ApiKeyRateLimitGateDeps, ApiRateLimitBindings };
