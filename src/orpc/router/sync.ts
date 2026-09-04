import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { syncAccountProviders } from "@/db/schema";
import { env } from "@/env";
import {
	linkSyncAccount,
	listSyncAccounts,
	SyncAccountCredentialsSchema,
	unlinkSyncAccount,
} from "@/lib/sync-accounts";
import { pushContinuity } from "@/lib/sync-push";
import { authed } from "@/orpc/base";
import { requireSyncEntitlement } from "@/orpc/sync-entitlement";

const SyncProviderInput = z.object({
	provider: z.enum(syncAccountProviders),
});

const ConnectInput = z
	.object({
		credentials: SyncAccountCredentialsSchema,
		externalAccountId: z.string().trim().min(1).optional(),
		provider: z.enum(syncAccountProviders),
	})
	.strict();

const masterKeyOf = (override: string | undefined): string => {
	const key = override ?? env.PROVIDER_CONFIG_MASTER_KEY;
	if (key === undefined) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "PROVIDER_CONFIG_MASTER_KEY is not configured.",
		});
	}
	return key;
};

const list = authed.handler(async ({ context }) => {
	await requireSyncEntitlement(context.db, context.user.id);
	return listSyncAccounts(context.db, context.user.id);
});

const connect = authed
	.input(ConnectInput)
	.handler(async ({ context, input }) => {
		await requireSyncEntitlement(context.db, context.user.id);
		return linkSyncAccount(context.db, {
			credentials: input.credentials,
			...(input.externalAccountId === undefined
				? {}
				: { externalAccountId: input.externalAccountId }),
			masterKeyBase64: masterKeyOf(context.providerConfigMasterKey),
			provider: input.provider,
			userId: context.user.id,
		});
	});

// Disconnect stays available after entitlement lapse so linked secrets can be revoked.
const disconnect = authed
	.input(SyncProviderInput)
	.handler(async ({ context, input }) => {
		const removed = await unlinkSyncAccount(
			context.db,
			context.user.id,
			input.provider,
		);
		if (!removed) {
			throw new ORPCError("NOT_FOUND", {
				message: "No linked account for that provider.",
			});
		}
		return { ok: true as const };
	});

const PushInput = z
	.object({
		continuityId: z.string().trim().min(1),
	})
	.strict();

const push = authed.input(PushInput).handler(async ({ context, input }) => {
	await requireSyncEntitlement(context.db, context.user.id);
	return pushContinuity({
		continuityId: input.continuityId,
		db: context.db,
		engine: context.engine,
		masterKeyBase64: masterKeyOf(context.providerConfigMasterKey),
		userId: context.user.id,
	});
});

const sync = { connect, disconnect, list, push };

export { sync };
