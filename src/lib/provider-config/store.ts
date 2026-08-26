import { desc, eq } from "drizzle-orm";

import type { Db } from "@/db";
import { llmProvider } from "@/db/schema";
import type { LlmProviderKind } from "@/db/schema";

import { decryptEnvelope, encryptEnvelope } from "./crypto.ts";
import {
	ProviderConfigSchema,
	UpdateProviderConfigSchema,
	mergeProviderConfig,
	toPublicConfig,
} from "./types.ts";
import type { ProviderConfig, ProviderPublicConfig } from "./types.ts";

interface ProviderRecord {
	id: string;
	kind: LlmProviderKind;
	label: string;
}

interface ProviderListItem extends ProviderRecord {
	config: ProviderPublicConfig;
}

interface StoreProviderInput {
	config: unknown;
	label: string;
}

interface UpdateProviderInput {
	config: unknown;
	id: string;
	label: string;
}

class ProviderNotFoundError extends Error {
	public constructor(id: string) {
		super(`provider-config: no provider stored for id "${id}"`);
		this.name = "ProviderNotFoundError";
	}
}

const storeProvider = async (
	db: Db,
	masterKeyBase64: string,
	input: StoreProviderInput,
): Promise<ProviderListItem> => {
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
	return {
		config: toPublicConfig(config),
		id,
		kind: config.kind,
		label: input.label,
	};
};

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
		throw new ProviderNotFoundError(id);
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

const listProviders = async (
	db: Db,
	masterKeyBase64: string,
): Promise<readonly ProviderListItem[]> => {
	const rows = await db
		.select({
			id: llmProvider.id,
			kind: llmProvider.kind,
			label: llmProvider.label,
		})
		.from(llmProvider)
		.orderBy(desc(llmProvider.createdAt))
		.all();

	return Promise.all(
		rows.map(async (row) => {
			const config = await getProviderConfig(db, masterKeyBase64, row.id);
			return {
				config: toPublicConfig(config),
				id: row.id,
				kind: row.kind,
				label: row.label,
			};
		}),
	);
};

const updateProvider = async (
	db: Db,
	masterKeyBase64: string,
	input: UpdateProviderInput,
): Promise<ProviderListItem> => {
	const existing = await getProviderConfig(db, masterKeyBase64, input.id);
	const update = UpdateProviderConfigSchema.parse(input.config);
	const config = ProviderConfigSchema.parse(
		mergeProviderConfig(existing, update),
	);
	const envelope = await encryptEnvelope(
		JSON.stringify(config),
		masterKeyBase64,
		input.id,
	);
	await db
		.update(llmProvider)
		.set({
			ciphertext: envelope.ciphertext,
			dataIv: envelope.dataIv,
			kind: config.kind,
			label: input.label,
			wrapIv: envelope.wrapIv,
			wrappedKey: envelope.wrappedKey,
		})
		.where(eq(llmProvider.id, input.id))
		.run();
	return {
		config: toPublicConfig(config),
		id: input.id,
		kind: config.kind,
		label: input.label,
	};
};

const removeProvider = async (db: Db, id: string): Promise<void> => {
	const result = await db
		.delete(llmProvider)
		.where(eq(llmProvider.id, id))
		.run();
	if (result.meta.changes === 0) {
		throw new ProviderNotFoundError(id);
	}
};

export {
	ProviderNotFoundError,
	getProviderConfig,
	listProviders,
	removeProvider,
	storeProvider,
	updateProvider,
};
export type {
	ProviderListItem,
	ProviderRecord,
	StoreProviderInput,
	UpdateProviderInput,
};
