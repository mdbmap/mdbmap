import { eq } from "drizzle-orm";

import type { Db } from "@/db";
import { llmProvider } from "@/db/schema";
import type { LlmProviderKind } from "@/db/schema";

import { decryptEnvelope, encryptEnvelope } from "./crypto.ts";
import { ProviderConfigSchema } from "./types.ts";
import type { ProviderConfig } from "./types.ts";

interface ProviderRecord {
	id: string;
	kind: LlmProviderKind;
	label: string;
}

interface StoreProviderInput {
	config: unknown;
	label: string;
}

// Encrypts `input.config` on write; the master key never reaches the row.
const storeProvider = async (
	db: Db,
	masterKeyBase64: string,
	input: StoreProviderInput,
): Promise<ProviderRecord> => {
	const config = ProviderConfigSchema.parse(input.config);
	const id = crypto.randomUUID();
	const envelope = await encryptEnvelope(
		JSON.stringify(config),
		masterKeyBase64,
		id,
	);
	await db
		.insert(llmProvider)
		.values({
			ciphertext: envelope.ciphertext,
			dataIv: envelope.dataIv,
			id,
			kind: config.kind,
			label: input.label,
			wrapIv: envelope.wrapIv,
			wrappedKey: envelope.wrappedKey,
		})
		.run();
	return { id, kind: config.kind, label: input.label };
};

// The typed accessor callers use to get a configured provider: decrypts on
// read and validates the recovered shape before handing it back.
const getProviderConfig = async (
	db: Db,
	masterKeyBase64: string,
	id: string,
): Promise<ProviderConfig> => {
	const row = await db
		.select()
		.from(llmProvider)
		.where(eq(llmProvider.id, id))
		.get();
	if (row === undefined) {
		throw new Error(`provider-config: no provider stored for id "${id}"`);
	}

	const plaintext = await decryptEnvelope(
		{
			ciphertext: row.ciphertext,
			dataIv: row.dataIv,
			wrapIv: row.wrapIv,
			wrappedKey: row.wrappedKey,
		},
		masterKeyBase64,
		id,
	);
	return ProviderConfigSchema.parse(JSON.parse(plaintext));
};

export { getProviderConfig, storeProvider };
export type { ProviderRecord, StoreProviderInput };
