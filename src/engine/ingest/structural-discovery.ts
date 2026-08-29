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

import { instalmentEnumerableServices } from "./enumerable-services.ts";
import { NotEnumerableServiceError } from "./not-enumerable.ts";

interface StructuralDiscoveryDeps {
	readonly fetchFn?: typeof fetch;
	readonly simkl?: SimklClient;
}

const MAX_ENUMERATION_PAGES = 100;

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
	status: z.string().nullable().optional(),
	title: z.object({ romaji: z.string().nullable().optional() }).optional(),
});

const anilistDescriptorMediaSchema = z.object({
	idMal: z.number().nullable().optional(),
	startDate: anilistStartDateSchema.optional(),
});

const anilistDescriptorSchema = z.object({
	data: z.object({
		Media: anilistDescriptorMediaSchema.nullable().optional(),
	}),
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

const jikanExternalEntrySchema = z.object({
	name: z.string().optional(),
	url: z.string().optional(),
});

const jikanAiredSchema = z.object({ from: z.string().optional() });

const jikanAnimeDataSchema = z.object({
	aired: jikanAiredSchema.optional(),
	airing: z.boolean().optional(),
	episodes: z.number().nullable().optional(),
	external: z.array(jikanExternalEntrySchema).optional(),
	status: z.string().optional(),
});

const jikanAnimeSchema = z.object({
	data: jikanAnimeDataSchema,
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
				"query ($id: Int, $page: Int) { Media(id: $id, type: ANIME) { episodes status episodesList(page: $page, perPage: 50) { pageInfo { hasNextPage } episodes { episode airingAt title { romaji } } } startDate { year month day } title { romaji } } }",
			variables: { id: Number(serviceId), page },
		}),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(`anilist: ${response.status} for media ${serviceId}`);
	}
	const parsed = anilistResponseSchema.safeParse(await response.json());
	if (!parsed.success) {
		throw new Error(
			`anilist: malformed media payload for ${serviceId} page ${page}`,
		);
	}
	return parsed.data.data.Media;
};

const collectAnilistEpisodes = async (
	serviceId: string,
	page: number,
	entries: (readonly [InstalmentLocator, InstalmentFacts])[],
	fallbackTitle: string,
	fallbackAirDate: string | undefined,
	fetchFn: typeof fetch,
	initialMedia?: z.infer<typeof anilistMediaSchema> | null,
): Promise<void> => {
	const media =
		initialMedia === undefined
			? await fetchAnilistPage(serviceId, page, fetchFn)
			: initialMedia;
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
	if (
		episodePage?.pageInfo?.hasNextPage === true &&
		page < MAX_ENUMERATION_PAGES
	) {
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

const anilistBoundaryFromMedia = (
	media: z.infer<typeof anilistMediaSchema> | null | undefined,
): InstalmentStream["boundary"] => {
	if (media?.status === "RELEASING" || media?.status === "NOT_YET_RELEASED") {
		return "airing";
	}
	if (media?.episodes === undefined || media?.episodes === null) {
		return "airing";
	}
	return "complete";
};

const enumerateAnilist = async (
	serviceId: string,
	fetchFn: typeof fetch,
): Promise<EnumeratedTitle> => {
	const head = await fetchAnilistPage(serviceId, 1, fetchFn);
	const totalEpisodes = head?.episodes;
	let boundary = anilistBoundaryFromMedia(head);
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
		head,
	);
	const locators = entries.map(([locator]) => locator);
	if (
		totalEpisodes !== undefined &&
		totalEpisodes !== null &&
		entries.length < totalEpisodes &&
		boundary === "complete"
	) {
		boundary = "truncated";
	}
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
	if (!parsed.success) {
		throw new Error(`jikan: malformed anime payload for mal:${serviceId}`);
	}
	return parsed.data.data;
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
	if (!parsed.success) {
		throw new Error(
			`jikan: malformed episodes payload for mal:${serviceId} page ${page}`,
		);
	}
	const { data } = parsed.data;
	for (const row of data) {
		const episode = row.episode ?? entries.length + 1;
		entries.push([
			instalmentLocator(`s1e${episode}`),
			{ title: row.title ?? "" },
		]);
	}
	return parsed.data.pagination?.has_next_page === true;
};

const paginateMalEpisodes = async (
	serviceId: string,
	page: number,
	entries: (readonly [InstalmentLocator, InstalmentFacts])[],
	fetchFn: typeof fetch,
): Promise<void> => {
	const hasNext = await collectMalEpisodes(serviceId, page, entries, fetchFn);
	if (hasNext && page < MAX_ENUMERATION_PAGES) {
		await paginateMalEpisodes(serviceId, page + 1, entries, fetchFn);
	}
};

const enumerateMal = async (
	serviceId: string,
	fetchFn: typeof fetch,
): Promise<EnumeratedTitle> => {
	const meta = await fetchMalAnimeMeta(serviceId, fetchFn);
	let boundary = malBoundaryFromMeta(meta);
	const entries: (readonly [InstalmentLocator, InstalmentFacts])[] = [];
	await paginateMalEpisodes(serviceId, 1, entries, fetchFn);
	if (
		meta?.episodes !== undefined &&
		meta.episodes !== null &&
		entries.length < meta.episodes &&
		boundary === "complete"
	) {
		boundary = "truncated";
	}
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
	if (!instalmentEnumerableServices.has(title.service)) {
		throw new NotEnumerableServiceError(title.service);
	}
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

const anilistIdFromExternalUrl = (
	url: string | undefined,
): string | undefined => {
	if (url === undefined) {
		return undefined;
	}
	const match = /anilist\.co\/anime\/(?<id>\d+)/u.exec(url);
	return match?.groups?.["id"];
};

const startDateFromAnilist = (
	startDate: z.infer<typeof anilistStartDateSchema> | undefined,
): string | undefined => {
	if (startDate?.year === undefined || startDate.year === null) {
		return undefined;
	}
	const month = startDate.month ?? 1;
	const day = startDate.day ?? 1;
	return `${startDate.year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

const fetchAnilistDescriptor = async (
	serviceId: string,
	fetchFn: typeof fetch,
): Promise<{ externalIds: ServiceRef[]; firstAirDate: string | undefined }> => {
	const response = await fetchFn("https://graphql.anilist.co", {
		body: JSON.stringify({
			query:
				"query ($id: Int) { Media(id: $id, type: ANIME) { idMal startDate { year month day } } }",
			variables: { id: Number(serviceId) },
		}),
		headers: { "Content-Type": "application/json" },
		method: "POST",
	});
	if (!response.ok) {
		throw new Error(`anilist: ${response.status} for descriptor ${serviceId}`);
	}
	const payload = await response.json();
	const parsed = anilistDescriptorSchema.safeParse(payload);
	if (!parsed.success) {
		throw new Error(`anilist: malformed descriptor payload for ${serviceId}`);
	}
	const media = parsed.data.data.Media;
	const externalIds =
		media?.idMal === undefined || media.idMal === null
			? []
			: [{ service: "mal", serviceId: String(media.idMal) }];
	return {
		externalIds,
		firstAirDate: startDateFromAnilist(media?.startDate),
	};
};

const malRefsFromMeta = (
	meta: z.infer<typeof jikanAnimeSchema>["data"] | undefined,
): ServiceRef[] => {
	if (meta === undefined) {
		return [];
	}
	const refs: ServiceRef[] = [];
	for (const entry of meta.external ?? []) {
		const anilistId = anilistIdFromExternalUrl(entry.url);
		if (anilistId !== undefined) {
			refs.push({ service: "anilist", serviceId: anilistId });
		}
	}
	return refs;
};

const directDescribe = async (
	title: ServiceRef,
	fetchFn: typeof fetch,
): Promise<{
	externalIds: readonly ServiceRef[];
	firstAirDate: string | undefined;
}> => {
	if (title.service === "mal") {
		const meta = await fetchMalAnimeMeta(title.serviceId, fetchFn);
		return {
			externalIds: malRefsFromMeta(meta),
			firstAirDate: meta?.aired?.from?.slice(0, 10),
		};
	}
	if (title.service === "anilist") {
		return fetchAnilistDescriptor(title.serviceId, fetchFn);
	}
	return { externalIds: [], firstAirDate: undefined };
};

const directFind = async (
	shared: ServiceRef,
	fetchFn: typeof fetch,
): Promise<readonly ServiceRef[]> => {
	if (shared.service === "mal") {
		const meta = await fetchMalAnimeMeta(shared.serviceId, fetchFn);
		return malRefsFromMeta(meta);
	}
	if (shared.service === "anilist") {
		const descriptor = await fetchAnilistDescriptor(shared.serviceId, fetchFn);
		return [...descriptor.externalIds];
	}
	return [];
};

const simklRefsOf = (
	entry: NonNullable<Awaited<ReturnType<SimklClient["findByExternalId"]>>>,
	excludeService?: string,
): ServiceRef[] =>
	Object.entries(entry.externalIds)
		.filter(([service]) => service !== excludeService)
		.map(([service, serviceId]) => ({
			service,
			serviceId:
				service === "tmdb"
					? `${entry.type === "movie" ? "movie" : "tv"}:${serviceId}`
					: serviceId,
		}));

const simklLookupId = (title: ServiceRef): string =>
	title.service === "tmdb"
		? (title.serviceId.split(":")[1] ?? title.serviceId)
		: title.serviceId;

const buildStructuralDiscoveryClients = (
	deps: StructuralDiscoveryDeps,
): DiscoveryClients => {
	const { fetchFn = fetch, simkl } = deps;

	return {
		externalIds: {
			describe: async (title) => {
				if (simkl !== undefined && isSimklService(title.service)) {
					try {
						const entry = await simkl.findByExternalId(
							title.service,
							simklLookupId(title),
						);
						if (entry === undefined) {
							return await directDescribe(title, fetchFn);
						}
						return {
							externalIds: simklRefsOf(entry),
							firstAirDate: entry.firstAirDate,
						};
					} catch {
						return directDescribe(title, fetchFn);
					}
				}
				return directDescribe(title, fetchFn);
			},
		},
		find: {
			find: async (shared) => {
				if (simkl !== undefined && isSimklService(shared.service)) {
					try {
						const entry = await simkl.findByExternalId(
							shared.service,
							simklLookupId(shared),
						);
						if (entry !== undefined) {
							return simklRefsOf(entry, shared.service);
						}
					} catch {
						return directFind(shared, fetchFn);
					}
				}
				return directFind(shared, fetchFn);
			},
		},
		instalments: {
			enumerate: async (title) => enumerateTitle(title, fetchFn),
		},
	};
};

export { buildStructuralDiscoveryClients };
export type { StructuralDiscoveryDeps };
