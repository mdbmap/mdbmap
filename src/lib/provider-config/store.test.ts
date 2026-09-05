/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { llmProvider } from "@/db/schema";
import { freshDb } from "@/db/test-helpers.ts";

import {
	ProviderNotFoundError,
	getProviderConfig,
	listProviders,
	removeProvider,
	storeProvider,
	updateProvider,
} from "./store.ts";
import { randomMasterKey } from "./test-support.ts";
import type {
	OpenAiCompatibleProviderConfig,
	ProviderConfig,
} from "./types.ts";

describe("provider config store", () => {
	let db: Awaited<ReturnType<typeof freshDb>>;
	let masterKey: string;

	beforeEach(async () => {
		db = await freshDb();
		masterKey = randomMasterKey();
	});

	it("round-trips a Vercel AI SDK provider", async () => {
		const config: ProviderConfig = {
			apiKey: "sk-vercel-secret",
			kind: "anthropic",
			model: "claude-sonnet",
		};

		const record = await storeProvider(db, masterKey, {
			config,
			label: "Anthropic (prod)",
		});

		await expect(getProviderConfig(db, masterKey, record.id)).resolves.toEqual(
			config,
		);
	});

	it("carries the base URL and key for an OpenAI-compatible entry", async () => {
		const config: OpenAiCompatibleProviderConfig = {
			apiKey: "sk-openrouter-secret",
			baseUrl: "https://openrouter.ai/api/v1",
			kind: "openai-compatible",
			model: "meta-llama/llama-3",
		};

		const record = await storeProvider(db, masterKey, {
			config,
			label: "OpenRouter",
		});

		const resolved = await getProviderConfig(db, masterKey, record.id);
		expect(resolved).toEqual(config);
		expect(resolved.kind).toBe("openai-compatible");
		if (resolved.kind === "openai-compatible") {
			expect(resolved.baseUrl).toBe(config.baseUrl);
			expect(resolved.apiKey).toBe(config.apiKey);
		}
	});

	it("rejects invalid provider config before writing", async () => {
		await expect(
			storeProvider(db, masterKey, {
				config: {
					apiKey: "",
					kind: "openai",
					model: "",
				},
				label: "Invalid",
			}),
		).rejects.toThrow();

		await expect(
			storeProvider(db, masterKey, {
				config: {
					apiKey: "   ",
					kind: "openai",
					model: "gpt-5",
				},
				label: "Whitespace key",
			}),
		).rejects.toThrow();

		await expect(db.select().from(llmProvider).all()).resolves.toEqual([]);
	});

	it("never stores the api key in plaintext at rest", async () => {
		const config: ProviderConfig = {
			apiKey: "sk-should-not-leak",
			kind: "openai",
			model: "gpt-5",
		};

		const record = await storeProvider(db, masterKey, {
			config,
			label: "OpenAI",
		});

		const rows = await db.select().from(llmProvider).all();
		const stored = rows.find((candidate) => candidate.id === record.id);

		expect(stored).toBeDefined();
		expect(stored?.ciphertext).not.toContain(config.apiKey);
		expect(stored?.ciphertext).not.toBe(JSON.stringify(config));
		// plaintext metadata columns stay readable without decrypting
		expect(stored?.kind).toBe("openai");
		expect(stored?.label).toBe("OpenAI");
	});

	it("fails to decrypt under the wrong master key", async () => {
		const config: ProviderConfig = {
			apiKey: "sk-secret",
			kind: "google",
			model: "gemini-pro",
		};
		const record = await storeProvider(db, masterKey, {
			config,
			label: "Gemini",
		});

		await expect(
			getProviderConfig(db, randomMasterKey(), record.id),
		).rejects.toThrow();
	});

	it("rejects an envelope copied from another provider row", async () => {
		const first = await storeProvider(db, masterKey, {
			config: {
				apiKey: "sk-first",
				kind: "openai",
				model: "gpt-5",
			},
			label: "First",
		});
		const second = await storeProvider(db, masterKey, {
			config: {
				apiKey: "sk-second",
				kind: "anthropic",
				model: "claude-sonnet",
			},
			label: "Second",
		});
		const secondRow = await db
			.select()
			.from(llmProvider)
			.where(eq(llmProvider.id, second.id))
			.get();
		expect(secondRow).toBeDefined();
		if (secondRow === undefined) {
			return;
		}

		await db
			.update(llmProvider)
			.set({
				ciphertext: secondRow.ciphertext,
				dataIv: secondRow.dataIv,
				wrapIv: secondRow.wrapIv,
				wrappedKey: secondRow.wrappedKey,
			})
			.where(eq(llmProvider.id, first.id))
			.run();

		await expect(getProviderConfig(db, masterKey, first.id)).rejects.toThrow();
	});

	it("rejects an unknown provider id", async () => {
		await expect(
			getProviderConfig(db, masterKey, crypto.randomUUID()),
		).rejects.toBeInstanceOf(ProviderNotFoundError);
		await expect(
			removeProvider(db, crypto.randomUUID()),
		).rejects.toBeInstanceOf(ProviderNotFoundError);
	});

	it("lists providers without returning api keys", async () => {
		await storeProvider(db, masterKey, {
			config: {
				apiKey: "sk-secret-never-list",
				kind: "openai",
				model: "gpt-5",
			},
			label: "OpenAI",
		});

		const listed = await listProviders(db, masterKey);
		expect(listed).toHaveLength(1);
		expect(listed[0]).toMatchObject({
			config: { kind: "openai", model: "gpt-5" },
			kind: "openai",
			label: "OpenAI",
		});
		expect(listed[0]).not.toHaveProperty("apiKey");
		expect(JSON.stringify(listed)).not.toContain("sk-secret-never-list");
	});

	it("updates a provider and keeps the key when omitted", async () => {
		const record = await storeProvider(db, masterKey, {
			config: {
				apiKey: "sk-original",
				kind: "openai",
				model: "gpt-4",
			},
			label: "OpenAI",
		});

		await updateProvider(db, masterKey, {
			config: { kind: "openai", model: "gpt-5" },
			id: record.id,
			label: "OpenAI (prod)",
		});

		await expect(getProviderConfig(db, masterKey, record.id)).resolves.toEqual({
			apiKey: "sk-original",
			kind: "openai",
			model: "gpt-5",
		});

		await updateProvider(db, masterKey, {
			config: {
				apiKey: "sk-rotated",
				kind: "anthropic",
				model: "claude-sonnet",
			},
			id: record.id,
			label: "Anthropic",
		});

		await expect(getProviderConfig(db, masterKey, record.id)).resolves.toEqual({
			apiKey: "sk-rotated",
			kind: "anthropic",
			model: "claude-sonnet",
		});
	});

	it("rejects a kind change that omits the api key", async () => {
		const record = await storeProvider(db, masterKey, {
			config: {
				apiKey: "sk-openai-only",
				kind: "openai",
				model: "gpt-5",
			},
			label: "OpenAI",
		});

		await expect(
			updateProvider(db, masterKey, {
				config: { kind: "anthropic", model: "claude-sonnet" },
				id: record.id,
				label: "Anthropic",
			}),
		).rejects.toThrow("API key is required when changing provider kind");

		await expect(getProviderConfig(db, masterKey, record.id)).resolves.toEqual({
			apiKey: "sk-openai-only",
			kind: "openai",
			model: "gpt-5",
		});
	});

	it("removes a provider", async () => {
		const record = await storeProvider(db, masterKey, {
			config: {
				apiKey: "sk-gone",
				kind: "google",
				model: "gemini-pro",
			},
			label: "Gemini",
		});

		await removeProvider(db, record.id);
		await expect(listProviders(db, masterKey)).resolves.toEqual([]);
		await expect(getProviderConfig(db, masterKey, record.id)).rejects.toThrow();
	});
});
