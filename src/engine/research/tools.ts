import type { Promisable } from "type-fest";

import type { Db } from "@/db";
import type {
	CatalogueClient,
	SimklClient,
	SimklEntry,
} from "@/engine/discovery";

import { parseResearchCatalogue } from "./catalogue.ts";
import type { ResearchCatalogueRecord } from "./catalogue.ts";
import { isOfficialOperatorUrl } from "./domains.ts";
import { persistCatalogueSpokes } from "./persist.ts";
import type { PersistedTitle, ServiceRef } from "./persist.ts";

// Per-service catalogue fetch used by research tools. Real wiring shares the
// same client the verify/discovery path uses; tests inject fixtures.
type ResearchCatalogueClient = CatalogueClient & {
	// Optional richer fetch that already carries instalment locators so the
	// tool can persist spokes without a second round trip.
	readonly fetchCatalogue?: (
		serviceId: string,
	) => Promisable<unknown>;
};

type ResearchCatalogueClients = Partial<
	Record<string, ResearchCatalogueClient>
>;

interface ScrapeRequest {
	readonly operator: string;
	readonly url: string;
}

interface ScrapeClient {
	readonly fetchPage: (request: ScrapeRequest) => Promisable<unknown>;
}

interface BoundApiToolResult {
	readonly kind: "api";
	readonly operator: string;
	readonly persisted: PersistedTitle;
	readonly record: ResearchCatalogueRecord;
	readonly ref: ServiceRef;
	readonly validated: true;
}

interface BoundHintToolResult {
	readonly entry: SimklEntry;
	readonly kind: "simkl-hint";
}

interface BoundScrapeToolResult {
	readonly kind: "scrape";
	readonly operator: string;
	readonly payload: unknown;
	readonly url: string;
}

type BoundToolResult =
	| BoundApiToolResult
	| BoundHintToolResult
	| BoundScrapeToolResult;

interface ResearchToolset {
	readonly fetchCatalogue: (
		service: string,
		serviceId: string,
	) => Promise<BoundApiToolResult>;
	readonly fetchSimklHint: (simklId: string) => Promise<BoundHintToolResult>;
	readonly scrapeOfficial: (
		request: ScrapeRequest,
	) => Promise<BoundScrapeToolResult>;
}

interface BuildToolsetInput {
	readonly clients: ResearchCatalogueClients;
	readonly db: Db;
	readonly groupId: number;
	readonly scrape?: ScrapeClient;
	readonly simkl?: SimklClient;
}

const asCatalogueRaw = (raw: object): unknown =>
	"title" in raw
		? {
				...raw,
				instalments:
					"instalments" in raw
						? (raw as { instalments?: unknown }).instalments
						: [],
			}
		: raw;

const objectPayload = (raw: unknown): object | undefined =>
	raw instanceof Object ? raw : undefined;

const buildResearchTools = (input: BuildToolsetInput): ResearchToolset => {
	const { clients, db, groupId, scrape, simkl } = input;

	return {
		fetchCatalogue: async (service, serviceId) => {
			const client = clients[service];
			if (client === undefined) {
				throw new Error(`research tools: no catalogue client for ${service}`);
			}
			const raw =
				client.fetchCatalogue === undefined
					? await client.fetchTitle(serviceId)
					: await client.fetchCatalogue(serviceId);
			if (raw === undefined) {
				throw new Error(
					`research tools: ${service}:${serviceId} returned nothing`,
				);
			}
			const objectRaw = objectPayload(raw);
			const record = parseResearchCatalogue(
				objectRaw === undefined ? raw : asCatalogueRaw(objectRaw),
			);
			const ref = { service, serviceId };
			const persisted = await persistCatalogueSpokes(db, groupId, ref, record);
			return {
				kind: "api",
				operator: service,
				persisted,
				record,
				ref,
				validated: true,
			};
		},

		fetchSimklHint: async (simklId) => {
			if (simkl === undefined) {
				throw new Error("research tools: SIMKL hint client is not configured");
			}
			const entry = await simkl.fetchEntry(simklId);
			if (entry === undefined) {
				throw new Error(`research tools: SIMKL entry ${simklId} missing`);
			}
			// SIMKL is a hint source only (ADR-0004) — never persisted as a spoke
			// and never counted toward corroboration.
			return { entry, kind: "simkl-hint" };
		},

		scrapeOfficial: async (request) => {
			if (!isOfficialOperatorUrl(request.url, request.operator)) {
				throw new Error(
					`research tools: refusing non-official URL for ${request.operator}: ${request.url}`,
				);
			}
			if (scrape === undefined) {
				throw new Error("research tools: scrape client is not configured");
			}
			const payload = await scrape.fetchPage(request);
			return {
				kind: "scrape",
				operator: request.operator,
				payload,
				url: request.url,
			};
		},
	};
};

export { buildResearchTools };
export type {
	BoundApiToolResult,
	BoundHintToolResult,
	BoundScrapeToolResult,
	BoundToolResult,
	ResearchCatalogueClient,
	ResearchCatalogueClients,
	ResearchToolset,
	ScrapeClient,
	ScrapeRequest,
};
