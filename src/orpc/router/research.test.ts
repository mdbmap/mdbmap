import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { freshDb } from "@/db/test-helpers";
import type { ORPCContext, SessionUser } from "@/orpc/context";

import { router } from "./index.ts";

const clientFor = async (user: SessionUser | undefined) =>
	createRouterClient(router, {
		context: {
			db: await freshDb(),
			resolveSession: () => user,
		} satisfies ORPCContext,
	});

describe("research timing admin gate", () => {
	it("rejects an unauthenticated caller", async () => {
		const client = await clientFor(undefined);
		await expect(client.research.getTiming()).rejects.toThrow();
	});

	it("rejects a signed-in non-admin", async () => {
		const client = await clientFor({ id: "user-1" });
		await expect(client.research.getTiming()).rejects.toThrow();
	});
});

describe("research timing admin surface", () => {
	const adminUser: SessionUser = { id: "admin-1", role: "admin" };

	it("reads off by default and persists admin writes", async () => {
		const client = await clientFor(adminUser);
		await expect(client.research.getTiming()).resolves.toBe("off");
		await expect(
			client.research.setTiming({ timing: "before-builds" }),
		).resolves.toBe("before-builds");
		await expect(client.research.getTiming()).resolves.toBe("before-builds");
	});
});
