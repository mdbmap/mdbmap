import { ORPCError } from "@orpc/server";

import { env } from "@/env";
import {
	ProviderKindKeyRequiredError,
	ProviderNotFoundError,
	getProviderConfig,
	listProviders,
	removeProvider,
	storeProvider,
	toPublicConfig,
	updateProvider,
} from "@/lib/provider-config";
import { getResearchTiming, setResearchTiming } from "@/lib/research-policy";
import { admin } from "@/orpc/base";
import type { ProviderRow, ResearchTiming } from "@/orpc/schema";
import {
	CreateProviderInput,
	RemoveProviderInput,
	SetResearchTimingInput,
	UpdateProviderInput,
} from "@/orpc/schema";

const masterKeyOf = (override: string | undefined): string => {
	const key = override ?? env.PROVIDER_CONFIG_MASTER_KEY;
	if (key === undefined) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "PROVIDER_CONFIG_MASTER_KEY is not configured.",
		});
	}
	return key;
};

const mapProviderError = (error: unknown): never => {
	if (error instanceof ProviderNotFoundError) {
		throw new ORPCError("NOT_FOUND", { message: error.message });
	}
	if (error instanceof ProviderKindKeyRequiredError) {
		throw new ORPCError("BAD_REQUEST", { message: error.message });
	}
	throw error;
};

const list = admin.handler(async ({ context }): Promise<readonly ProviderRow[]> => {
	const masterKey = masterKeyOf(context.providerConfigMasterKey);
	return listProviders(context.db, masterKey);
});

const create = admin
	.input(CreateProviderInput)
	.handler(async ({ context, input }): Promise<ProviderRow> => {
		const masterKey = masterKeyOf(context.providerConfigMasterKey);
		const record = await storeProvider(context.db, masterKey, {
			config: input.config,
			label: input.label,
		});
		const config = await getProviderConfig(context.db, masterKey, record.id);
		return {
			config: toPublicConfig(config),
			id: record.id,
			kind: record.kind,
			label: record.label,
		};
	});

const update = admin
	.input(UpdateProviderInput)
	.handler(async ({ context, input }): Promise<ProviderRow> => {
		const masterKey = masterKeyOf(context.providerConfigMasterKey);
		try {
			const record = await updateProvider(context.db, masterKey, {
				config: input.config,
				id: input.id,
				label: input.label,
			});
			const config = await getProviderConfig(context.db, masterKey, record.id);
			return {
				config: toPublicConfig(config),
				id: record.id,
				kind: record.kind,
				label: record.label,
			};
		} catch (error) {
			return mapProviderError(error);
		}
	});

const remove = admin
	.input(RemoveProviderInput)
	.handler(async ({ context, input }): Promise<void> => {
		try {
			await removeProvider(context.db, input.id);
		} catch (error) {
			mapProviderError(error);
		}
	});

const getTiming = admin.handler(async ({ context }): Promise<ResearchTiming> =>
	getResearchTiming(context.db),
);

const setTiming = admin
	.input(SetResearchTimingInput)
	.handler(async ({ context, input }): Promise<ResearchTiming> =>
		setResearchTiming(context.db, input.timing),
	);

const providers = { create, getTiming, list, remove, setTiming, update };

export { providers };
