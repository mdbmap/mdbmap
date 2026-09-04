import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "@/db";
import type { SyncAccountProvider } from "@/db/schema";
import { syncAccountLink } from "@/db/schema";
import {
	decryptEnvelope,
	encryptEnvelope,
} from "@/lib/provider-config/crypto.ts";

const SyncAccountCredentialsSchema = z
	.object({
		accessToken: z.string().min(1).optional(),
		apiKey: z.string().min(1).optional(),
		refreshToken: z.string().min(1).optional(),
	})
	.strict();

type SyncAccountCredentials = z.infer<typeof SyncAccountCredentialsSchema>;

interface SyncAccountPublic {
	readonly cursor: string | null;
	readonly externalAccountId: string | null;
	readonly lastError: string | null;
	readonly linkedAt: Date | null;
	readonly provider: SyncAccountProvider;
}

interface LinkSyncAccountInput {
	readonly credentials: SyncAccountCredentials;
	readonly externalAccountId?: string;
	readonly masterKeyBase64: string;
	readonly provider: SyncAccountProvider;
	readonly userId: string;
}

const aadFor = (userId: string, provider: SyncAccountProvider): string =>
	`sync-account:${userId}:${provider}`;

const toPublic = (row: {
	cursor: string | null;
	externalAccountId: string | null;
	lastError: string | null;
	linkedAt: Date | null;
	provider: SyncAccountProvider;
}): SyncAccountPublic => ({
	cursor: row.cursor,
	externalAccountId: row.externalAccountId,
	lastError: row.lastError,
	linkedAt: row.linkedAt,
	provider: row.provider,
});

const publicColumns = {
	cursor: syncAccountLink.cursor,
	externalAccountId: syncAccountLink.externalAccountId,
	lastError: syncAccountLink.lastError,
	linkedAt: syncAccountLink.linkedAt,
	provider: syncAccountLink.provider,
} as const;

const listSyncAccounts = async (
	db: Db,
	userId: string,
): Promise<readonly SyncAccountPublic[]> => {
	const rows = await db
		.select(publicColumns)
		.from(syncAccountLink)
		.where(eq(syncAccountLink.userId, userId))
		.all();
	return rows.map((row) => toPublic(row));
};

const readLinkedAccount = async (
	db: Db,
	userId: string,
	provider: SyncAccountProvider,
): Promise<SyncAccountPublic> => {
	const row = await db
		.select(publicColumns)
		.from(syncAccountLink)
		.where(
			and(
				eq(syncAccountLink.userId, userId),
				eq(syncAccountLink.provider, provider),
			),
		)
		.get();
	if (row === undefined) {
		throw new Error("sync-accounts: link write did not persist");
	}
	return toPublic(row);
};

const linkSyncAccount = async (
	db: Db,
	input: LinkSyncAccountInput,
): Promise<SyncAccountPublic> => {
	const envelope = await encryptEnvelope(
		JSON.stringify(input.credentials),
		input.masterKeyBase64,
		aadFor(input.userId, input.provider),
	);
	const linkedAt = new Date();
	const envelopeColumns = {
		ciphertext: envelope.ciphertext,
		dataIv: envelope.dataIv,
		wrapIv: envelope.wrapIv,
		wrappedKey: envelope.wrappedKey,
	};
	await db
		.insert(syncAccountLink)
		.values({
			...envelopeColumns,
			externalAccountId: input.externalAccountId,
			linkedAt,
			provider: input.provider,
			userId: input.userId,
		})
		.onConflictDoUpdate({
			set: {
				...envelopeColumns,
				externalAccountId: input.externalAccountId,
				lastError: sql`NULL`,
				linkedAt,
			},
			target: [syncAccountLink.userId, syncAccountLink.provider],
		})
		.run();
	return readLinkedAccount(db, input.userId, input.provider);
};

const unlinkSyncAccount = async (
	db: Db,
	userId: string,
	provider: SyncAccountProvider,
): Promise<boolean> => {
	const result = await db
		.delete(syncAccountLink)
		.where(
			and(
				eq(syncAccountLink.userId, userId),
				eq(syncAccountLink.provider, provider),
			),
		)
		.run();
	return result.meta.changes > 0;
};

const readSyncAccountCredentials = async (
	db: Db,
	masterKeyBase64: string,
	userId: string,
	provider: SyncAccountProvider,
): Promise<SyncAccountCredentials | undefined> => {
	const row = await db
		.select({
			ciphertext: syncAccountLink.ciphertext,
			dataIv: syncAccountLink.dataIv,
			wrapIv: syncAccountLink.wrapIv,
			wrappedKey: syncAccountLink.wrappedKey,
		})
		.from(syncAccountLink)
		.where(
			and(
				eq(syncAccountLink.userId, userId),
				eq(syncAccountLink.provider, provider),
			),
		)
		.get();
	if (row === undefined) {
		return undefined;
	}
	const plaintext = await decryptEnvelope(
		{
			ciphertext: row.ciphertext,
			dataIv: row.dataIv,
			wrapIv: row.wrapIv,
			wrappedKey: row.wrappedKey,
		},
		masterKeyBase64,
		aadFor(userId, provider),
	);
	const parsed: unknown = JSON.parse(plaintext);
	return SyncAccountCredentialsSchema.parse(parsed);
};

export {
	linkSyncAccount,
	listSyncAccounts,
	readSyncAccountCredentials,
	unlinkSyncAccount,
};
export type { LinkSyncAccountInput, SyncAccountCredentials, SyncAccountPublic };
