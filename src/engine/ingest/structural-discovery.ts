import { z } from "zod";

import type { InstalmentLocator } from "@/db/schema";
import type { SimklClient, SimklService } from "@/engine/discovery/simkl.ts";
import { simklServices } from "@/engine/discovery/simkl.ts";
import type {
	DiscoveryClients,
	EnumeratedTitle,
	ServiceRef,
} from "@/engine/discovery/structural.ts";
import type {
	FactsByLocator,
	InstalmentFacts,
	InstalmentStream,
} from "@/engine/matcher";

interface StructuralDiscoveryDeps {
	readonly fetchFn?: typeof fetch;
	readonly simkl: SimklClient;
}

const anilistStartDateSchema = z.object({
	day: z.number().nullable().optional(),
	month: z.number().nullable().optional(),
	year: z.number().nullable().optional(),
});

const anilistMediaSchema = z.object({
	episodes: z.number().nullable().optional(),
	startDate: anilistStartDateSchema.optional(),
	title: z.object({ romaji: z.string().nullable().optional() }).optional(),
});

const anilistResponseSchema = z.object({
	data: z.object({ Media: anilistMediaSchema.nullable().optional() }),
});

const jikanEpisodeRowSchema = z.object({
	episode: z.number().optional(),
	title: z.string().optional(),
});

const jikanEpisodesSchema = z.object({
	data: z.array(jikanEpisodeRowSchema),
});

const isSimklService = (value: string): value is SimklService =>
	(simklServices as readonly string[]).includes(value);

const instalmentLocator = (raw: string): InstalmentLocator => raw;

const instalmentStream = (
	locators: readonly InstalmentLocator[],
): InstalmentStream => ({
	boundary: "complete",
	instalments: locators.map((locator) => ({
		kind: "regular",
		locator,
	})),
});

const factsOf = (
	entries: readonly (readonly [InstalmentLocator, InstalmentFacts])[],
): FactsByLocator => {
	const map = new Map<InstalmentLocator, InstalmentFacts>();
	for (const [locator, fact] of entries) {
		map.set(locator, fact);
	}
	return map;
};

const optionalAirDate = (
	year: number | null | undefined,
	month: number | null | undefined,
	day: number | null | undefined,
): string | undefined => {
	if (year === undefined || year === null) {
		return undefined;
	}
	return `${year}-${String(month ?? 1).padStart(2, "0")}-${String(day ?? 1).padStart(2, "0")}`;
};

const enumerateAnilist = async (
	serviceId: string,
	fetchFn: typeof fetch,
): Promise<EnumeratedTitle> => {
	const response = await fetchFn("https://graphql.anilist.co", {
		body: JSON.stringify({
			query:
				"query ($id: Int) { Media(id: $id, type: ANIME) { episodes title { romaji } startDate { year month day } } }",
			variables: { id: Number(serviceId) },
		}),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(`anilist: ${response.status} for media ${serviceId}`);
	}
	const parsed = anilistResponseSchema.safeParse(await response.json());
	const media = parsed.success ? parsed.data.data.Media : undefined;
	const episodeCount = media?.episodes ?? 0;
	const title = media?.title?.romaji ?? "";
	const airDate = optionalAirDate(
		media?.startDate?.year,
		media?.startDate?.month,
		media?.startDate?.day,
	);
	const entries: (readonly [InstalmentLocator, InstalmentFacts])[] = [];
	for (let episode = 1; episode <= episodeCount; episode += 1) {
		const locator = instalmentLocator(`s1e${episode}`);
		const fact: InstalmentFacts =
			airDate === undefined ? { title } : { airDate, title };
		entries.push([locator, fact]);
	}
	const locators = entries.map(([locator]) => locator);
	return { facts: factsOf(entries), stream: instalmentStream(locators) };
};

const enumerateMal = async (
	serviceId: string,
	fetchFn: typeof fetch,
): Promise<EnumeratedTitle> => {
	const response = await fetchFn(
		`https://api.jikan.moe/v4/anime/${serviceId}/episodes`,
	);
	if (!response.ok) {
		throw new Error(`jikan: ${response.status} for mal:${serviceId}`);
	}
	const parsed = jikanEpisodesSchema.safeParse(await response.json());
	const data = parsed.success ? parsed.data.data : [];
	const entries: (readonly [InstalmentLocator, InstalmentFacts])[] = data.map(
		(row) => {
			const episode = row.episode ?? 1;
			return [
				instalmentLocator(`s1e${episode}`),
				{ title: row.title ?? "" },
			] as const;
		},
	);
	const locators = entries.map(([locator]) => locator);
	return { facts: factsOf(entries), stream: instalmentStream(locators) };
};

const enumerateTitle = async (
	title: ServiceRef,
	fetchFn: typeof fetch,
): Promise<EnumeratedTitle> => {
	switch (title.service) {
		case "anilist": {
			return enumerateAnilist(title.serviceId, fetchFn);
		}
		case "mal": {
			return enumerateMal(title.serviceId, fetchFn);
		}
		default: {
			throw new Error(
				`structural discovery: unsupported enumeration service ${title.service}`,
			);
		}
	}
};

const simklRefsOf = (
	entry: NonNullable<Awaited<ReturnType<SimklClient["findByExternalId"]>>>,
	excludeService?: string,
): ServiceRef[] =>
	Object.entries(entry.externalIds)
		.filter(([service]) => service !== excludeService)
		.map(([service, serviceId]) => ({ service, serviceId }));

const buildStructuralDiscoveryClients = (
	deps: StructuralDiscoveryDeps,
): DiscoveryClients => {
	const { fetchFn = fetch, simkl } = deps;

	return {
		externalIds: {
			describe: async (title) => {
				if (!isSimklService(title.service)) {
					return { externalIds: [], firstAirDate: undefined };
				}
				const entry = await simkl.findByExternalId(
					title.service,
					title.serviceId,
				);
				if (entry === undefined) {
					return { externalIds: [], firstAirDate: undefined };
				}
				return {
					externalIds: simklRefsOf(entry),
					firstAirDate: undefined,
				};
			},
		},
		find: {
			find: async (shared) => {
				if (!isSimklService(shared.service)) {
					return [];
				}
				const entry = await simkl.findByExternalId(
					shared.service,
					shared.serviceId,
				);
				return entry === undefined ? [] : simklRefsOf(entry, shared.service);
			},
		},
		instalments: {
			enumerate: async (title) => enumerateTitle(title, fetchFn),
		},
	};
};

export { buildStructuralDiscoveryClients };
export type { StructuralDiscoveryDeps };
