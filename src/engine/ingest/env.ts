import { createDb } from "@/db";
import type { Db } from "@/db";
import type { SimklClient, VerificationClients } from "@/engine/discovery";
import type { DiscoveryClients } from "@/engine/discovery/structural.ts";
import { createWorkflowDispatcher } from "@/engine/overflow/cold.ts";
import type { BuildDispatcher } from "@/engine/overflow/cold.ts";

import type {
	AfterPublishFuzzyConfig,
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
import { buildStructuralDiscoveryClients } from "./structural-discovery.ts";

type IngestBindings = Pick<
	Env,
	"API_RATE_LIMIT" | "DB" | "METADATA_KV" | "OVERFLOW_BUILD"
>;

interface IngestEnvOverrides {
	readonly afterPublish?: AfterPublishFuzzyConfig;
	readonly structuralDiscovery?: DiscoveryClients;
	readonly catalogue?: Partial<{
		readonly simkl: SimklClient;
		readonly verification: VerificationClients;
	}>;
	readonly db?: Db;
}

interface IngestEnv {
	readonly afterPublish?: AfterPublishFuzzyConfig;
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
	const overrideAfterPublish = overrides?.afterPublish;
	const scheduler = overrideAfterPublish?.scheduler ?? defaultScheduler;
	const resolvedAfterPublish =
		overrideAfterPublish !== undefined &&
		Object.keys(overrideAfterPublish.clients).length > 0 &&
		scheduler !== undefined
			? {
					...overrideAfterPublish,
					scheduler,
				}
			: undefined;
	return {
		...(resolvedAfterPublish === undefined
			? {}
			: { afterPublish: resolvedAfterPublish }),
		catalogue: {
			simkl: overrides?.catalogue?.simkl ?? built.simkl,
			verification: overrides?.catalogue?.verification ?? built.verification,
		},
		db: overrides?.db ?? createDb(bindings.DB),
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
export type {
	CreateIngestEnvInput,
	IngestBindings,
	IngestEnv,
	IngestEnvOverrides,
};
