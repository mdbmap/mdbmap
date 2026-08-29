import { createDb } from "@/db";
import type { Db } from "@/db";
import type { SimklClient, VerificationClients } from "@/engine/discovery";
import type { DiscoveryClients } from "@/engine/discovery/structural.ts";
import { createWorkflowDispatcher } from "@/engine/overflow/cold.ts";
import type { BuildDispatcher } from "@/engine/overflow/cold.ts";

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
	readonly structuralDiscovery?: DiscoveryClients;
	readonly catalogue?: Partial<{
		readonly simkl: SimklClient;
		readonly verification: VerificationClients;
	}>;
	readonly db?: Db;
}

interface IngestEnv {
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
	readonly overrides?: IngestEnvOverrides | undefined;
	readonly secrets: CatalogueSecrets;
}

const createIngestEnv = (input: CreateIngestEnvInput): IngestEnv => {
	const { bindings, overrides, secrets } = input;
	const built = buildCatalogueClients({ secrets });
	return {
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
): IngestEnv =>
	createIngestEnv({
		bindings,
		overrides,
		secrets: parseCatalogueSecrets(source),
	});

const resolveIngestEnv = async (
	overrides?: IngestEnvOverrides,
): Promise<IngestEnv> => {
	const { env } = await import("cloudflare:workers");
	return createIngestEnvFromSource(
		env,
		readCatalogueSecretsSource(env),
		overrides,
	);
};

export { createIngestEnv, createIngestEnvFromSource, resolveIngestEnv };
export type {
	CreateIngestEnvInput,
	IngestBindings,
	IngestEnv,
	IngestEnvOverrides,
};
