import type { Db } from "@/db";
import { resolveDb } from "@/db";
import type { ApiKeyPlan } from "@/db/schema";

import { verifyApiKey } from "./verify.ts";

const RETRY_AFTER_SECONDS = 60;

const API_RATE_LIMIT_BINDING_BY_PLAN = {
	free: "API_RATE_LIMIT",
	pro: "API_RATE_LIMIT",
} as const satisfies Record<ApiKeyPlan, "API_RATE_LIMIT">;

type ApiRateLimitBindingName =
	(typeof API_RATE_LIMIT_BINDING_BY_PLAN)[ApiKeyPlan];

type ApiRateLimitBindings = Readonly<Record<ApiKeyPlan, RateLimit>>;

interface ApiKeyRateLimitGateDeps {
	readonly db?: Db | undefined;
	readonly rateLimits: ApiRateLimitBindings;
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

const enforceApiKeyRateLimit = async (
	request: Request,
	deps: ApiKeyRateLimitGateDeps,
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

	const limiter = deps.rateLimits[verified.plan];
	const { success } = await limiter.limit({ key: verified.id });
	if (!success) {
		return tooManyRequestsResponse();
	}
	return undefined;
};

const withPublicApiGate = async (
	request: Request,
	next: () => Promise<Response>,
	deps: {
		readonly db?: Db | undefined;
		readonly rateLimits?: ApiRateLimitBindings | undefined;
	} = {},
): Promise<Response> => {
	let { rateLimits } = deps;
	if (rateLimits === undefined) {
		const { env } = await import("cloudflare:workers");
		rateLimits = resolveApiRateLimits(env);
	}
	const denial = await enforceApiKeyRateLimit(request, {
		db: deps.db,
		rateLimits,
	});
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
