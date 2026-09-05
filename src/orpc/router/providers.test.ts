import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { freshDb } from "@/db/test-helpers";
import { randomMasterKey } from "@/lib/provider-config/test-support.ts";
import type { ORPCContext, SessionUser } from "@/orpc/context";

import { router } from "./index.ts";

const clientFor = async (user: SessionUser | undefined, masterKey?: string) =>
	createRouterClient(router, {
		context: {
			db: await freshDb(),
			providerConfigMasterKey: masterKey ?? randomMasterKey(),
			resolveSession: () => user,
		} satisfies ORPCContext,
	});

const expectRejected = async (operation: () => Promise<unknown>) => {
	let rejected = false;
	try {
		await operation();
	} catch {
		rejected = true;
	}
	expect(rejected).toBe(true);
};

const expectEveryOperationRejected = async (user: SessionUser | undefined) => {
	const client = await clientFor(user);
	await expectRejected(async () => client.providers.list());
	await expectRejected(async () =>
		client.providers.create({
			config: { apiKey: "sk-x", kind: "openai", model: "gpt-5" },
			label: "x",
		}),
	);
	await expectRejected(async () =>
		client.providers.update({
			config: { kind: "openai", model: "gpt-5" },
			id: "p-1",
			label: "x",
		}),
	);
	await expectRejected(async () => client.providers.remove({ id: "p-1" }));
	await expectRejected(async () => client.providers.getTiming());
	await expectRejected(async () =>
		client.providers.setTiming({ timing: "off" }),
	);
};

describe("provider admin gate", () => {
	it("rejects every operation for unauthenticated and non-admin callers", async () => {
		await expectEveryOperationRejected(undefined);
		await expectEveryOperationRejected({ id: "user-1" });
	});
});

describe("provider admin surface", () => {
	const adminUser: SessionUser = { id: "admin-1", role: "admin" };

	it("creates a provider and never returns the api key", async () => {
		const client = await clientFor(adminUser);
		const created = await client.providers.create({
			config: {
				apiKey: "sk-should-not-leak",
				kind: "openai",
				model: "gpt-5",
			},
			label: "OpenAI",
		});

		expect(created).toMatchObject({
			config: { kind: "openai", model: "gpt-5" },
			label: "OpenAI",
		});
		expect(JSON.stringify(created)).not.toContain("sk-should-not-leak");
		expect(created).not.toHaveProperty("apiKey");

		const listed = await client.providers.list();
		expect(listed).toHaveLength(1);
		expect(JSON.stringify(listed)).not.toContain("sk-should-not-leak");
	});

	it("updates without re-entering the key and removes a provider", async () => {
		const client = await clientFor(adminUser);
		const created = await client.providers.create({
			config: {
				apiKey: "sk-keep",
				kind: "anthropic",
				model: "claude-sonnet",
			},
			label: "Anthropic",
		});

		const updated = await client.providers.update({
			config: { kind: "anthropic", model: "claude-opus" },
			id: created.id,
			label: "Anthropic (prod)",
		});
		expect(updated).toMatchObject({
			config: { kind: "anthropic", model: "claude-opus" },
			label: "Anthropic (prod)",
		});
		expect(JSON.stringify(updated)).not.toContain("sk-keep");

		await client.providers.remove({ id: created.id });
		await expect(client.providers.list()).resolves.toEqual([]);
	});

	it("persists research timing for the orchestrator reader", async () => {
		const client = await clientFor(adminUser);
		await expect(client.providers.getTiming()).resolves.toBe("off");
		await expect(
			client.providers.setTiming({ timing: "before-builds" }),
		).resolves.toBe("before-builds");
		await expect(client.providers.getTiming()).resolves.toBe("before-builds");
		await expect(
			client.providers.setTiming({ timing: "after-residue" }),
		).resolves.toBe("after-residue");
	});

	it("maps missing providers to NOT_FOUND", async () => {
		const client = await clientFor(adminUser);
		const missing = crypto.randomUUID();

		await expect(
			client.providers.update({
				config: { kind: "openai", model: "gpt-5" },
				id: missing,
				label: "gone",
			}),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			client.providers.remove({ id: missing }),
		).rejects.toMatchObject({
			code: "NOT_FOUND",
		});
	});

	it("rejects a kind change without a fresh api key", async () => {
		const client = await clientFor(adminUser);
		const created = await client.providers.create({
			config: {
				apiKey: "sk-openai-only",
				kind: "openai",
				model: "gpt-5",
			},
			label: "OpenAI",
		});

		await expect(
			client.providers.update({
				config: { kind: "anthropic", model: "claude-sonnet" },
				id: created.id,
				label: "Anthropic",
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			message: "API key is required when changing provider kind",
		});

		const listed = await client.providers.list();
		expect(listed).toEqual([
			{
				config: { kind: "openai", model: "gpt-5" },
				id: created.id,
				kind: "openai",
				label: "OpenAI",
			},
		]);
	});
});
