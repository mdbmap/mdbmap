import { z } from "zod";

import type { InstalmentLocator } from "@/db/schema";
import type { SimklClient } from "@/engine/discovery/simkl.ts";
import { isSimklService } from "@/engine/discovery/simkl.ts";
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

const enumeratableServices = new Set(["anilist", "mal"]);

const anilistStartDateSchema = z.object({
	day: z.number().nullable().optional(),
	month: z.number().nullable().optional(),
	year: z.number().nullable().optional(),
});

const anilistEpisodeRowSchema = z.object({
	airingAt: z.number().nullable().optional(),
	episode: z.number().nullable().optional(),
	title: z.object({ romaji: z.string().nullable().optional() }).optional(),
});

const anilistEpisodesPageSchema = z.object({
	episodes: z.array(anilistEpisodeRowSchema),
	pageInfo: z.object({ hasNextPage: z.boolean().optional() }).optional(),
});

const anilistMediaSchema = z.object({
	episodes: z.number().nullable().optional(),
	episodesList: anilistEpisodesPageSchema.optional(),
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
	pagination: z.object({ has_next_page: z.boolean().optional() }).optional(),
});

const jikanAnimeSchema = z.object({
	data: z.object({
		airing: z.boolean().optional(),
		episodes: z.number().nullable().optional(),
		status: z.string().optional(),
	}),
});

const instalmentLocator = (raw: string): InstalmentLocator => raw;

const instalmentStream = (
	locators: readonly InstalmentLocator[],
	boundary: InstalmentStream["boundary"],
): InstalmentStream => ({
	boundary,
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

const skippedEnumerated = (): EnumeratedTitle => ({
	facts: factsOf([]),
	stream: instalmentStream([], "complete"),
});

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

const timestampToAirDate = (
	timestamp: number | null | undefined,
): string | undefined => {
	if (timestamp === undefined || timestamp === null) {
		return undefined;
	}
	return new Date(timestamp * 1000).toISOString().slice(0, 10);
};

const fetchAnilistPage = async (
	serviceId: string,
	page: number,
	fetchFn: typeof fetch,
) => {
	const response = await fetchFn("https://graphql.anilist.co", {
		body: JSON.stringify({
			query:
				"query ($id: Int, $page: Int) { Media(id: $id, type: ANIME) { episodes episodesList(page: $page, perPage: 50) { pageInfo { hasNextPage } episodes { episode airingAt title { romaji } } } startDate { year month day } title { romaji } } }",
			variables: { id: Number(serviceId), page },
		}),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(`anilist: ${response.status} for media ${serviceId}`);
	}
	const parsed = anilistResponseSchema.safeParse(await response.json());
	return parsed.success ? parsed.data.data.Media : undefined;
};

const collectAnilistEpisodes = async (
	serviceId: string,
	page: number,
	entries: (readonly [InstalmentLocator, InstalmentFacts])[],
	fallbackTitle: string,
	fallbackAirDate: string | undefined,
	fetchFn: typeof fetch,
): Promise<void> => {
	const media = await fetchAnilistPage(serviceId, page, fetchFn);
	const episodePage = media?.episodesList;
	for (const row of episodePage?.episodes ?? []) {
		const episode = row.episode ?? entries.length + 1;
		const locator = instalmentLocator(`s1e${episode}`);
		const title = row.title?.romaji ?? fallbackTitle;
		const airDate = timestampToAirDate(row.airingAt) ?? fallbackAirDate;
		const fact: InstalmentFacts =
			airDate === undefined ? { title } : { airDate, title };
		entries.push([locator, fact]);
	}
	if (episodePage?.pageInfo?.hasNextPage === true) {
		await collectAnilistEpisodes(
			serviceId,
			page + 1,
			entries,
			fallbackTitle,
			fallbackAirDate,
			fetchFn,
		);
	}
};

const enumerateAnilist = async (
	serviceId: string,
	fetchFn: typeof fetch,
): Promise<EnumeratedTitle> => {
	const head = await fetchAnilistPage(serviceId, 1, fetchFn);
	const totalEpisodes = head?.episodes;
	const boundary: InstalmentStream["boundary"] =
		totalEpisodes === undefined || totalEpisodes === null
			? "airing"
			: "complete";
	const fallbackTitle = head?.title?.romaji ?? "";
	const fallbackAirDate = optionalAirDate(
		head?.startDate?.year,
		head?.startDate?.month,
		head?.startDate?.day,
	);
	const entries: (readonly [InstalmentLocator, InstalmentFacts])[] = [];
	await collectAnilistEpisodes(
		serviceId,
		1,
		entries,
		fallbackTitle,
		fallbackAirDate,
		fetchFn,
	);
	const locators = entries.map(([locator]) => locator);
	return {
		facts: factsOf(entries),
		stream: instalmentStream(locators, boundary),
	};
};

const fetchMalAnimeMeta = async (
	serviceId: string,
	fetchFn: typeof fetch,
): Promise<z.infer<typeof jikanAnimeSchema>["data"] | undefined> => {
	const response = await fetchFn(`https://api.jikan.moe/v4/anime/${serviceId}`);
	if (!response.ok) {
		throw new Error(`jikan: ${response.status} for mal:${serviceId}`);
	}
	const parsed = jikanAnimeSchema.safeParse(await response.json());
	return parsed.success ? parsed.data.data : undefined;
};

const malBoundaryFromMeta = (
	meta: z.infer<typeof jikanAnimeSchema>["data"] | undefined,
): InstalmentStream["boundary"] => {
	if (meta?.airing === true || meta?.status === "Currently Airing") {
		return "airing";
	}
	if (meta?.episodes === undefined || meta?.episodes === null) {
		return "airing";
	}
	return "complete";
};

const collectMalEpisodes = async (
	serviceId: string,
	page: number,
	entries: (readonly [InstalmentLocator, InstalmentFacts])[],
	fetchFn: typeof fetch,
): Promise<boolean> => {
	const response = await fetchFn(
		`https://api.jikan.moe/v4/anime/${serviceId}/episodes?page=${page}`,
	);
	if (!response.ok) {
		throw new Error(`jikan: ${response.status} for mal:${serviceId}`);
	}
	const parsed = jikanEpisodesSchema.safeParse(await response.json());
	const data = parsed.success ? parsed.data.data : [];
	for (const row of data) {
		const episode = row.episode ?? entries.length + 1;
		entries.push([
			instalmentLocator(`s1e${episode}`),
			{ title: row.title ?? "" },
		]);
	}
	return parsed.success && parsed.data.pagination?.has_next_page === true;
};

const paginateMalEpisodes = async (
	serviceId: string,
	page: number,
	entries: (readonly [InstalmentLocator, InstalmentFacts])[],
	fetchFn: typeof fetch,
): Promise<void> => {
	const hasNext = await collectMalEpisodes(serviceId, page, entries, fetchFn);
	if (hasNext) {
		await paginateMalEpisodes(serviceId, page + 1, entries, fetchFn);
	}
};

const enumerateMal = async (
	serviceId: string,
	fetchFn: typeof fetch,
): Promise<EnumeratedTitle> => {
	const meta = await fetchMalAnimeMeta(serviceId, fetchFn);
	const boundary = malBoundaryFromMeta(meta);
	const entries: (readonly [InstalmentLocator, InstalmentFacts])[] = [];
	await paginateMalEpisodes(serviceId, 1, entries, fetchFn);
	const locators = entries.map(([locator]) => locator);
	return {
		facts: factsOf(entries),
		stream: instalmentStream(locators, boundary),
	};
};

const enumerateTitle = async (
	title: ServiceRef,
	fetchFn: typeof fetch,
): Promise<EnumeratedTitle> => {
	if (!enumeratableServices.has(title.service)) {
		return skippedEnumerated();
	}
	switch (title.service) {
		case "anilist": {
			return enumerateAnilist(title.serviceId, fetchFn);
		}
		case "mal": {
			return enumerateMal(title.serviceId, fetchFn);
		}
		default: {
			return skippedEnumerated();
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
					firstAirDate: entry.firstAirDate,
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
