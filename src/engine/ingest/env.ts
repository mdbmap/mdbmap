import { createDb } from "@/db";
import type { Db } from "@/db";
import type { SimklClient, VerificationClients } from "@/engine/discovery";
import type { DiscoveryClients } from "@/engine/discovery/structural.ts";
import { createWorkflowDispatcher } from "@/engine/overflow/cold.ts";
import type { BuildDispatcher } from "@/engine/overflow/cold.ts";

import type {
	AfterPublishConfig,
	AfterPublishScheduler,
} from "./after-publish.ts";
import {
	parseCatalogueSecrets,
	readCatalogueSecretsSource,
} from "./catalogue-secrets.ts";
import type {
	CatalogueSecrets,
	CatalogueSecretsSource,
} from "./catalogue-secrets.ts";
import { buildCatalogueClients } from "./clients.ts";
import {
	buildAfterPublishResearch,
	providerMasterKeyOf,
	resolveAfterPublish,
} from "./research-bindings.ts";
import { buildStructuralDiscoveryClients } from "./structural-discovery.ts";

type IngestBindings = Pick<
	Env,
	"API_RATE_LIMIT" | "DB" | "METADATA_KV" | "OVERFLOW_BUILD"
> & {
	readonly PROVIDER_CONFIG_MASTER_KEY?: string;
};

interface IngestEnvOverrides {
	readonly afterPublish?: AfterPublishConfig;
	readonly structuralDiscovery?: DiscoveryClients;
	readonly catalogue?: Partial<{
		readonly simkl: SimklClient;
		readonly verification: VerificationClients;
	}>;
	readonly db?: Db;
}

interface IngestEnv {
	readonly afterPublish?: AfterPublishConfig;
	readonly structuralDiscovery: DiscoveryClients | undefined;
	readonly catalogue: {
		readonly simkl: SimklClient | undefined;
		readonly verification: VerificationClients;
	};
	readonly db: Db;
	readonly dispatcher: BuildDispatcher | undefined;
}

interface CreateIngestEnvInput {
	readonly bindings: IngestBindings;
	readonly defaultScheduler?: AfterPublishScheduler;
	readonly overrides?: IngestEnvOverrides | undefined;
	readonly secrets: CatalogueSecrets;
}

const createIngestEnv = (input: CreateIngestEnvInput): IngestEnv => {
	const { bindings, defaultScheduler, overrides, secrets } = input;
	const built = buildCatalogueClients({ secrets });
	const db = overrides?.db ?? createDb(bindings.DB);
	const catalogue = {
		simkl: overrides?.catalogue?.simkl ?? built.simkl,
		verification: overrides?.catalogue?.verification ?? built.verification,
	};
	const scheduler = overrides?.afterPublish?.scheduler ?? defaultScheduler;
	const resolvedAfterPublish =
		scheduler === undefined
			? undefined
			: resolveAfterPublish({
					catalogue,
					defaultResearch: buildAfterPublishResearch(
						db,
						providerMasterKeyOf(bindings),
						catalogue,
					),
					override: overrides?.afterPublish,
					scheduler,
				});
	return {
		...(resolvedAfterPublish === undefined
			? {}
			: { afterPublish: resolvedAfterPublish }),
		catalogue,
		db,
		dispatcher:
			bindings.OVERFLOW_BUILD === undefined
				? undefined
				: createWorkflowDispatcher(bindings.OVERFLOW_BUILD),
		structuralDiscovery:
			overrides?.structuralDiscovery ??
			buildStructuralDiscoveryClients(
				built.simkl === undefined ? {} : { simkl: built.simkl },
			),
	};
};

const createIngestEnvFromSource = (
	bindings: IngestBindings,
	source: CatalogueSecretsSource,
	overrides?: IngestEnvOverrides,
	defaultScheduler?: AfterPublishScheduler,
): IngestEnv =>
	createIngestEnv({
		bindings,
		...(defaultScheduler === undefined ? {} : { defaultScheduler }),
		overrides,
		secrets: parseCatalogueSecrets(source),
	});

const resolveIngestEnv = async (
	overrides?: IngestEnvOverrides,
): Promise<IngestEnv> => {
	const [{ env }, { scheduleWithWaitUntil }] = await Promise.all([
		import("cloudflare:workers"),
		import("./schedule.workers.ts"),
	]);
	return createIngestEnvFromSource(
		env,
		readCatalogueSecretsSource(env),
		overrides,
		scheduleWithWaitUntil,
	);
};

export { createIngestEnv, createIngestEnvFromSource, resolveIngestEnv };
export type { AfterPublishConfig } from "./after-publish.ts";
export type {
	CreateIngestEnvInput,
	IngestBindings,
	IngestEnv,
	IngestEnvOverrides,
};
