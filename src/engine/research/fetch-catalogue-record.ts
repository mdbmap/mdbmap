import type { Promisable } from "type-fest";

import { researchCatalogueSchema } from "./catalogue.ts";
import type { ResearchCatalogueRecord } from "./catalogue.ts";

interface CatalogueFetchClient {
	readonly fetchCatalogue?: (serviceId: string) => Promisable<unknown>;
	readonly fetchTitle: (serviceId: string) => Promisable<unknown>;
}

const objectPayload = (raw: unknown): object | undefined =>
	raw instanceof Object ? raw : undefined;

const fetchCatalogueRecord = async (
	client: CatalogueFetchClient | undefined,
	serviceId: string,
): Promise<ResearchCatalogueRecord | undefined> => {
	if (client === undefined) {
		return undefined;
	}
	let raw: unknown;
	try {
		raw =
			client.fetchCatalogue === undefined
				? await client.fetchTitle(serviceId)
				: await client.fetchCatalogue(serviceId);
	} catch {
		return undefined;
	}
	if (raw === undefined) {
		return undefined;
	}
	const parsed = researchCatalogueSchema.safeParse(objectPayload(raw) ?? raw);
	return parsed.success ? parsed.data : undefined;
};

export { fetchCatalogueRecord };
export type { CatalogueFetchClient };
