import { describe, expect, it } from "vitest";

import { decryptEnvelope, encryptEnvelope } from "./crypto.ts";
import { randomMasterKey } from "./test-support.ts";

describe("provider-config envelope encryption", () => {
	it("round-trips the plaintext through encrypt then decrypt", async () => {
		const masterKey = randomMasterKey();
		const plaintext = JSON.stringify({ apiKey: "sk-secret", model: "gpt-5" });

		const envelope = await encryptEnvelope(plaintext, masterKey);

		await expect(decryptEnvelope(envelope, masterKey)).resolves.toBe(plaintext);
	});

	it("never stores the plaintext as the ciphertext", async () => {
		const masterKey = randomMasterKey();
		const plaintext = JSON.stringify({ apiKey: "sk-secret", model: "gpt-5" });

		const envelope = await encryptEnvelope(plaintext, masterKey);

		expect(envelope.ciphertext).not.toBe(plaintext);
		expect(envelope.ciphertext).not.toContain("sk-secret");
		expect(envelope.wrappedKey).not.toBe(plaintext);
	});

	it("produces a distinct data key and IVs per call, even for the same plaintext", async () => {
		const masterKey = randomMasterKey();
		const plaintext = "same plaintext both times";

		const first = await encryptEnvelope(plaintext, masterKey);
		const second = await encryptEnvelope(plaintext, masterKey);

		expect(first.ciphertext).not.toBe(second.ciphertext);
		expect(first.dataIv).not.toBe(second.dataIv);
		expect(first.wrappedKey).not.toBe(second.wrappedKey);
		expect(first.wrapIv).not.toBe(second.wrapIv);
	});

	it("rejects decryption under the wrong master key", async () => {
		const envelope = await encryptEnvelope("top secret", randomMasterKey());

		await expect(
			decryptEnvelope(envelope, randomMasterKey()),
		).rejects.toThrow();
	});
});
