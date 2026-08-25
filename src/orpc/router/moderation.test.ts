import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { freshDb } from "@/db/test-helpers";
import type { ORPCContext, SessionUser } from "@/orpc/context";

import { router } from "./index.ts";

const clientFor = (user: SessionUser | undefined) =>
	createRouterClient(router, {
		context: {
			db: freshDb(),
			resolveSession: () => user,
		} satisfies ORPCContext,
	});

describe("moderation admin gate", () => {
	it("rejects an unauthenticated caller", async () => {
		const client = clientFor(undefined);
		await expect(client.moderation.list()).rejects.toThrow();
	});

	it("rejects a signed-in non-admin", async () => {
		const client = clientFor({ id: "user-1" });
		await expect(client.moderation.list()).rejects.toThrow();
	});

	it("serves the queue to an admin", async () => {
		const client = clientFor({ id: "admin-1", role: "admin" });
		await expect(client.moderation.list()).resolves.toEqual([]);
	});
});
