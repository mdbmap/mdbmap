import { describe, expect, it, vi } from "vitest";

import { freshDb } from "@/db/test-helpers";

import { issueApiKey } from "./issue.ts";
import {
	API_RATE_LIMIT_BINDING_BY_PLAN,
	enforceApiKeyRateLimit,
	resolveApiRateLimits,
	RETRY_AFTER_SECONDS,
	withPublicApiGate,
} from "./rate-limit-gate.ts";
import type { ApiRateLimitBindings } from "./rate-limit-gate.ts";

const mockLimiter = (
	success: boolean,
): RateLimit & { limit: ReturnType<typeof vi.fn> } => ({
	limit: vi.fn().mockResolvedValue({ success }),
});

const bearerRequest = (secret: string): Request =>
	new Request("https://example.test/movie/tmdb:1", {
		headers: { authorization: `Bearer ${secret}` },
	});

describe("enforceApiKeyRateLimit", () => {
	it("rejects an unkeyed request upstream of the limiter", async () => {
		const free = mockLimiter(true);
		const pro = mockLimiter(true);
		const rateLimits: ApiRateLimitBindings = { free, pro };
		const db = await freshDb();

		const denial = await enforceApiKeyRateLimit(
			new Request("https://example.test/movie/tmdb:1"),
			{ db, rateLimits },
		);

		expect(denial?.status).toBe(401);
		expect(await denial?.json()).toEqual({ error: "Unauthorized" });
		expect(free.limit).not.toHaveBeenCalled();
		expect(pro.limit).not.toHaveBeenCalled();
	});

	it("rejects an invalid key upstream of the limiter", async () => {
		const free = mockLimiter(true);
		const pro = mockLimiter(true);
		const rateLimits: ApiRateLimitBindings = { free, pro };
		const db = await freshDb();

		const denial = await enforceApiKeyRateLimit(
			bearerRequest("mdbmap_not-a-real-key"),
			{ db, rateLimits },
		);

		expect(denial?.status).toBe(401);
		expect(await denial?.json()).toEqual({ error: "Unauthorized" });
		expect(free.limit).not.toHaveBeenCalled();
		expect(pro.limit).not.toHaveBeenCalled();
	});

	it("passes a key under the limit", async () => {
		const free = mockLimiter(true);
		const pro = mockLimiter(true);
		const rateLimits: ApiRateLimitBindings = { free, pro };
		const db = await freshDb();
		const issued = await issueApiKey(db, { label: "ci" });

		const denial = await enforceApiKeyRateLimit(bearerRequest(issued.secret), {
			db,
			rateLimits,
		});

		expect(denial).toBeUndefined();
		expect(free.limit).toHaveBeenCalledWith({ key: issued.id });
	});

	it("returns 429 with retry-after when over the limit", async () => {
		const free = mockLimiter(false);
		const pro = mockLimiter(true);
		const rateLimits: ApiRateLimitBindings = { free, pro };
		const db = await freshDb();
		const issued = await issueApiKey(db, { label: "ci" });

		const denial = await enforceApiKeyRateLimit(bearerRequest(issued.secret), {
			db,
			rateLimits,
		});

		expect(denial?.status).toBe(429);
		expect(denial?.headers.get("retry-after")).toBe(
			String(RETRY_AFTER_SECONDS),
		);
		expect(await denial?.json()).toEqual({
			error: "Too Many Requests",
			retryAfter: RETRY_AFTER_SECONDS,
		});
		expect(free.limit).toHaveBeenCalledWith({ key: issued.id });
	});

	it("selects the rate-limit binding from the key plan", async () => {
		const free = mockLimiter(true);
		const pro = mockLimiter(true);
		const rateLimits: ApiRateLimitBindings = { free, pro };
		const db = await freshDb();
		const issued = await issueApiKey(db, { label: "ci", plan: "pro" });

		const denial = await enforceApiKeyRateLimit(bearerRequest(issued.secret), {
			db,
			rateLimits,
		});

		expect(denial).toBeUndefined();
		expect(pro.limit).toHaveBeenCalledWith({ key: issued.id });
		expect(free.limit).not.toHaveBeenCalled();
	});
});

describe("resolveApiRateLimits", () => {
	it("reads bindings from the plan config map", () => {
		const freeBinding = mockLimiter(true);
		const env = { API_RATE_LIMIT: freeBinding };

		const rateLimits = resolveApiRateLimits(env);

		expect(rateLimits.free).toBe(freeBinding);
		expect(rateLimits.pro).toBe(env[API_RATE_LIMIT_BINDING_BY_PLAN.pro]);
		expect(API_RATE_LIMIT_BINDING_BY_PLAN.free).toBe("API_RATE_LIMIT");
	});
});

describe("withPublicApiGate", () => {
	it("returns denial responses without calling next", async () => {
		const free = mockLimiter(true);
		const pro = mockLimiter(true);
		const rateLimits: ApiRateLimitBindings = { free, pro };
		const db = await freshDb();
		const next = vi.fn().mockResolvedValue(new Response("ok"));

		const unkeyed = await withPublicApiGate(
			new Request("https://example.test/movie/tmdb:1"),
			next,
			{ db, rateLimits },
		);
		expect(unkeyed.status).toBe(401);
		expect(await unkeyed.json()).toEqual({ error: "Unauthorized" });
		expect(next).not.toHaveBeenCalled();

		const overLimit = mockLimiter(false);
		const issued = await issueApiKey(db, { label: "ci" });
		const denied = await withPublicApiGate(bearerRequest(issued.secret), next, {
			db,
			rateLimits: { free: overLimit, pro },
		});
		expect(denied.status).toBe(429);
		expect(denied.headers.get("retry-after")).toBe(String(RETRY_AFTER_SECONDS));
		expect(await denied.json()).toEqual({
			error: "Too Many Requests",
			retryAfter: RETRY_AFTER_SECONDS,
		});
		expect(next).not.toHaveBeenCalled();
	});

	it("forwards to next when the key is under the limit", async () => {
		const free = mockLimiter(true);
		const pro = mockLimiter(true);
		const rateLimits: ApiRateLimitBindings = { free, pro };
		const db = await freshDb();
		const issued = await issueApiKey(db, { label: "ci" });
		const next = vi
			.fn()
			.mockResolvedValue(new Response("mapped", { status: 200 }));

		const response = await withPublicApiGate(
			bearerRequest(issued.secret),
			next,
			{ db, rateLimits },
		);

		expect(response.status).toBe(200);
		expect(await response.text()).toBe("mapped");
		expect(next).toHaveBeenCalledOnce();
		expect(free.limit).toHaveBeenCalledWith({ key: issued.id });
	});

	it("resolves rateLimits from cloudflare:workers when omitted", async () => {
		const db = await freshDb();
		const issued = await issueApiKey(db, { label: "ci" });
		const next = vi.fn().mockResolvedValue(new Response("ok"));

		const response = await withPublicApiGate(
			bearerRequest(issued.secret),
			next,
			{ db },
		);

		expect(response.status).toBe(200);
		expect(next).toHaveBeenCalledOnce();
	});
});
