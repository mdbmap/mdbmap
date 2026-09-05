import { describe, expect, it } from "vitest";

import { decryptEnvelope, encryptEnvelope } from "./crypto.ts";
import { randomMasterKey } from "./test-support.ts";

describe("provider-config envelope encryption", () => {
	it("round-trips the plaintext through encrypt then decrypt", async () => {
		const masterKey = randomMasterKey();
		const plaintext = JSON.stringify({ apiKey: "sk-secret", model: "gpt-5" });
		const additionalData = crypto.randomUUID();

		const envelope = await encryptEnvelope(
			plaintext,
			masterKey,
			additionalData,
		);

		await expect(
			decryptEnvelope(envelope, masterKey, additionalData),
		).resolves.toBe(plaintext);
	});

	it("never stores the plaintext as the ciphertext", async () => {
		const masterKey = randomMasterKey();
		const plaintext = JSON.stringify({ apiKey: "sk-secret", model: "gpt-5" });

		const envelope = await encryptEnvelope(
			plaintext,
			masterKey,
			crypto.randomUUID(),
		);

		expect(envelope.ciphertext).not.toBe(plaintext);
		expect(envelope.ciphertext).not.toContain("sk-secret");
		expect(envelope.wrappedKey).not.toBe(plaintext);
	});

	it("produces a distinct data key and IVs per call, even for the same plaintext", async () => {
		const masterKey = randomMasterKey();
		const plaintext = "same plaintext both times";
		const additionalData = crypto.randomUUID();

		const first = await encryptEnvelope(plaintext, masterKey, additionalData);
		const second = await encryptEnvelope(plaintext, masterKey, additionalData);

		expect(first.ciphertext).not.toBe(second.ciphertext);
		expect(first.dataIv).not.toBe(second.dataIv);
		expect(first.wrappedKey).not.toBe(second.wrappedKey);
		expect(first.wrapIv).not.toBe(second.wrapIv);
	});

	it("rejects decryption under the wrong master key", async () => {
		const additionalData = crypto.randomUUID();
		const envelope = await encryptEnvelope(
			"top secret",
			randomMasterKey(),
			additionalData,
		);

		await expect(
			decryptEnvelope(envelope, randomMasterKey(), additionalData),
		).rejects.toThrow();
	});

	it("rejects decryption under different additional data", async () => {
		const masterKey = randomMasterKey();
		const envelope = await encryptEnvelope(
			"top secret",
			masterKey,
			crypto.randomUUID(),
		);

		await expect(
			decryptEnvelope(envelope, masterKey, crypto.randomUUID()),
		).rejects.toThrow();
	});

	it("reports ciphertext authentication failures at the module boundary", async () => {
		const masterKey = randomMasterKey();
		const additionalData = crypto.randomUUID();
		const envelope = await encryptEnvelope(
			"top secret",
			masterKey,
			additionalData,
		);
		const firstCharacter = envelope.ciphertext.startsWith("A") ? "B" : "A";

		await expect(
			decryptEnvelope(
				{
					...envelope,
					ciphertext: firstCharacter + envelope.ciphertext.slice(1),
				},
				masterKey,
				additionalData,
			),
		).rejects.toThrow(
			"provider-config: encrypted config failed authentication",
		);
	});
});
