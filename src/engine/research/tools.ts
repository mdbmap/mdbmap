import type { Promisable } from "type-fest";

import type { Db } from "@/db";
import type {
	CatalogueClient,
	SimklClient,
	SimklEntry,
} from "@/engine/discovery";

import type { ResearchCatalogueRecord } from "./catalogue.ts";
import { catalogueRequestUrl, isOfficialOperatorUrl } from "./domains.ts";
import { fetchCatalogueRecord } from "./fetch-catalogue-record.ts";
import { persistCatalogueSpokes } from "./persist.ts";
import type { PersistedTitle, ServiceRef } from "./persist.ts";

type ResearchCatalogueClient = CatalogueClient & {
	readonly fetchCatalogue?: (serviceId: string) => Promisable<unknown>;
	readonly requestUrl?: (serviceId: string) => string;
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

interface BoundApiAvailableResult {
	readonly kind: "api";
	readonly operator: string;
	readonly persisted: PersistedTitle;
	readonly record: ResearchCatalogueRecord;
	readonly ref: ServiceRef;
	readonly unavailable?: undefined;
	readonly url: string;
	readonly validated: true;
}

interface BoundApiUnavailableResult {
	readonly kind: "api";
	readonly operator: string;
	readonly ref: ServiceRef;
	readonly unavailable: true;
	readonly url: string;
	readonly validated: false;
}

type BoundApiToolResult = BoundApiAvailableResult | BoundApiUnavailableResult;

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

const resolveCatalogueUrl = (
	client: ResearchCatalogueClient,
	service: string,
	serviceId: string,
): string =>
	client.requestUrl === undefined
		? catalogueRequestUrl(service)
		: client.requestUrl(serviceId);

const buildResearchTools = (input: BuildToolsetInput): ResearchToolset => {
	const { clients, db, groupId, scrape, simkl } = input;

	return {
		fetchCatalogue: async (service, serviceId) => {
			const client = clients[service];
			const ref = { service, serviceId };
			if (client === undefined) {
				return {
					kind: "api",
					operator: service,
					ref,
					unavailable: true,
					url: "",
					validated: false,
				};
			}
			const resolvedUrl = resolveCatalogueUrl(client, service, serviceId);
			const record = await fetchCatalogueRecord(client, serviceId);
			if (record === undefined) {
				return {
					kind: "api",
					operator: service,
					ref,
					unavailable: true,
					url: resolvedUrl,
					validated: false,
				};
			}
			const persisted = await persistCatalogueSpokes(db, groupId, ref, record);
			return {
				kind: "api",
				operator: service,
				persisted,
				record,
				ref,
				url: resolvedUrl,
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
	BoundApiAvailableResult,
	BoundApiToolResult,
	BoundApiUnavailableResult,
	BoundHintToolResult,
	BoundScrapeToolResult,
	BoundToolResult,
	ResearchCatalogueClient,
	ResearchCatalogueClients,
	ResearchToolset,
	ScrapeClient,
	ScrapeRequest,
};
