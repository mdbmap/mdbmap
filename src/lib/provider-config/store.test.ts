/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { llmProvider } from "@/db/schema";
import { freshDb } from "@/db/test-helpers.ts";

import { getProviderConfig, storeProvider } from "./store.ts";
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
		).rejects.toThrow();
	});
});
