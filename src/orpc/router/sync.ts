import { ORPCError } from "@orpc/server";
import { z } from "zod";

import { syncAccountProviders } from "@/db/schema";
import { env } from "@/env";
import {
	linkSyncAccount,
	listSyncAccounts,
	unlinkSyncAccount,
} from "@/lib/sync-accounts";
import { authed } from "@/orpc/base";
import { requireSyncEntitlement } from "@/orpc/sync-entitlement";

const SyncProviderInput = z.object({
	provider: z.enum(syncAccountProviders),
});

const ConnectInput = z
	.object({
		credentials: z
			.object({
				accessToken: z.string().min(1).optional(),
				apiKey: z.string().min(1).optional(),
				refreshToken: z.string().min(1).optional(),
			})
			.refine(
				(value) =>
					value.accessToken !== undefined || value.apiKey !== undefined,
				"Provide an access token or API key.",
			),
		externalAccountId: z.string().min(1).optional(),
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
		const credentials = {
			...(input.credentials.accessToken === undefined
				? {}
				: { accessToken: input.credentials.accessToken }),
			...(input.credentials.apiKey === undefined
				? {}
				: { apiKey: input.credentials.apiKey }),
			...(input.credentials.refreshToken === undefined
				? {}
				: { refreshToken: input.credentials.refreshToken }),
		};
		return linkSyncAccount(context.db, {
			credentials,
			...(input.externalAccountId === undefined
				? {}
				: { externalAccountId: input.externalAccountId }),
			masterKeyBase64: masterKeyOf(context.providerConfigMasterKey),
			provider: input.provider,
			userId: context.user.id,
		});
	});

const disconnect = authed
	.input(SyncProviderInput)
	.handler(async ({ context, input }) => {
		await requireSyncEntitlement(context.db, context.user.id);
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

const sync = { connect, disconnect, list };

export { sync };
