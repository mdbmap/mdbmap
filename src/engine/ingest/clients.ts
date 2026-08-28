import { z } from "zod";

import { createSimklClient } from "@/engine/discovery";
import type {
	CatalogueClient,
	CatalogueTitle,
	SimklClient,
	VerificationClients,
} from "@/engine/discovery";
import {
	childrenNamed,
	firstChild,
	parseXml,
} from "@/orpc/providers/anidb-xml.ts";
import type { XmlNode } from "@/orpc/providers/anidb-xml.ts";
import { createRateLimiter } from "@/orpc/providers/rate-limit.ts";

import type { CatalogueSecrets } from "./catalogue-secrets.ts";

const ANIDB_FLOOD_INTERVAL_MS = 2000;

const emptyNode: XmlNode = { attrs: {}, children: [], tag: "", text: "" };

interface FetchDeps {
	readonly fetchFn?: typeof fetch;
}

interface TmdbVerificationClientDeps extends FetchDeps {
	readonly apiKey: string;
	readonly baseUrl?: string;
}

interface TvdbVerificationClientDeps extends FetchDeps {
	readonly apiKey: string;
	readonly baseUrl?: string;
}

interface AnidbVerificationClientDeps extends FetchDeps {
	readonly baseUrl?: string;
	readonly client: string;
	readonly clientVer: string;
	readonly rateLimiter?: ReturnType<typeof createRateLimiter>;
}

const tmdbRecordSchema = z.object({
	first_air_date: z.string().optional(),
	name: z.string().optional(),
	number_of_episodes: z.number().optional(),
	release_date: z.string().optional(),
	title: z.string().optional(),
});

const tvdbSeriesSchema = z.object({
	data: z.object({
		firstAired: z.string().optional(),
		name: z.string().optional(),
	}),
});

const tvdbLoginSchema = z.object({
	data: z.object({
		token: z.string(),
	}),
});

const tvdbEpisodeRowSchema = z.object({ id: z.number() });
const tvdbEpisodeLinksSchema = z.object({
	next: z.union([z.string(), z.number(), z.null()]).optional(),
});
const tvdbEpisodesSchema = z.object({
	data: z.array(tvdbEpisodeRowSchema),
	links: tvdbEpisodeLinksSchema.optional(),
});

const anidbFormatOf = (raw: string | undefined): string | undefined => {
	if (raw === undefined || raw === "") {
		return undefined;
	}
	const normalized = raw.toLowerCase();
	if (normalized.includes("movie")) {
		return "movie";
	}
	if (
		normalized.includes("ona") ||
		normalized.includes("ova") ||
		normalized.includes("web")
	) {
		return "ona";
	}
	return "tv";
};

const animeNodeOf = (root: XmlNode): XmlNode | undefined =>
	root.tag === "anime" ? root : firstChild(root, "anime");

const anidbTitleOf = (anime: XmlNode): string | undefined => {
	const titles = childrenNamed(
		firstChild(anime, "titles") ?? emptyNode,
		"title",
	);
	const preferred = titles.find((node) => node.attrs["xml:lang"] === "x-jat");
	return preferred?.text ?? titles[0]?.text;
};

const createTmdbVerificationClient = (
	deps: TmdbVerificationClientDeps,
): CatalogueClient => {
	const {
		apiKey,
		baseUrl = "https://api.themoviedb.org/3",
		fetchFn = fetch,
	} = deps;

	const fetchRecord = async (
		kind: "movie" | "tv",
		serviceId: string,
	): Promise<CatalogueTitle | undefined> => {
		const response = await fetchFn(
			`${baseUrl}/${kind}/${serviceId}?api_key=${encodeURIComponent(apiKey)}`,
		);
		if (!response.ok) {
			return undefined;
		}
		const parsed = tmdbRecordSchema.safeParse(await response.json());
		if (!parsed.success) {
			return undefined;
		}
		const title = parsed.data.name ?? parsed.data.title;
		if (title === undefined) {
			return undefined;
		}
		return {
			format: kind,
			instalmentCount: parsed.data.number_of_episodes,
			releaseDate: parsed.data.first_air_date ?? parsed.data.release_date,
			title,
		};
	};

	return {
		fetchTitle: async (serviceId) => {
			const tv = await fetchRecord("tv", serviceId);
			if (tv !== undefined) {
				return tv;
			}
			return fetchRecord("movie", serviceId);
		},
	};
};

const createTvdbVerificationClient = (
	deps: TvdbVerificationClientDeps,
): CatalogueClient => {
	const {
		apiKey,
		baseUrl = "https://api4.thetvdb.com/v4",
		fetchFn = fetch,
	} = deps;
	let token: string | undefined;

	const authorise = async (): Promise<string | undefined> => {
		if (token !== undefined) {
			return token;
		}
		const response = await fetchFn(`${baseUrl}/login`, {
			body: JSON.stringify({ apikey: apiKey }),
			headers: { "Content-Type": "application/json" },
			method: "POST",
		});
		if (!response.ok) {
			return undefined;
		}
		const parsed = tvdbLoginSchema.safeParse(await response.json());
		token = parsed.success ? parsed.data.data.token : undefined;
		return token;
	};

	const fetchEpisodePage = async (
		bearer: string,
		serviceId: string,
		page: number,
	): Promise<
		| { readonly kind: "ok"; readonly rows: number; readonly next: unknown }
		| { readonly kind: "failed" }
	> => {
		const response = await fetchFn(
			`${baseUrl}/series/${serviceId}/episodes/official?page=${page}`,
			{ headers: { Authorization: `Bearer ${bearer}` } },
		);
		if (!response.ok) {
			return { kind: "failed" };
		}
		const parsed = tvdbEpisodesSchema.safeParse(await response.json());
		if (!parsed.success) {
			return { kind: "failed" };
		}
		return {
			kind: "ok",
			next: parsed.data.links?.next,
			rows: parsed.data.data.length,
		};
	};

	const MAX_EPISODE_PAGES = 100;

	const fetchEpisodeCount = async (
		bearer: string,
		serviceId: string,
	): Promise<number | undefined> => {
		const countPages = async (
			page: number,
			total: number,
		): Promise<number | undefined> => {
			const pageResult = await fetchEpisodePage(bearer, serviceId, page);
			if (pageResult.kind === "failed") {
				return undefined;
			}
			const nextTotal = total + pageResult.rows;
			if (
				pageResult.rows === 0 ||
				page + 1 >= MAX_EPISODE_PAGES ||
				pageResult.next === undefined ||
				pageResult.next === null ||
				pageResult.next === 0
			) {
				return nextTotal > 0 ? nextTotal : undefined;
			}
			return countPages(page + 1, nextTotal);
		};
		return countPages(0, 0);
	};

	return {
		fetchTitle: async (serviceId) => {
			const bearer = await authorise();
			if (bearer === undefined) {
				return;
			}
			const response = await fetchFn(`${baseUrl}/series/${serviceId}`, {
				headers: { Authorization: `Bearer ${bearer}` },
			});
			if (!response.ok) {
				return;
			}
			const parsed = tvdbSeriesSchema.safeParse(await response.json());
			if (!parsed.success || parsed.data.data.name === undefined) {
				return;
			}
			const instalmentCount = await fetchEpisodeCount(bearer, serviceId);
			return {
				format: "tv",
				instalmentCount,
				releaseDate: parsed.data.data.firstAired,
				title: parsed.data.data.name,
			};
		},
	};
};

const defaultAnidbRateLimiter = createRateLimiter({
	intervalMs: ANIDB_FLOOD_INTERVAL_MS,
});

const createAnidbVerificationClient = (
	deps: AnidbVerificationClientDeps,
): CatalogueClient => {
	const {
		baseUrl = "http://api.anidb.net:9001/httpapi",
		client,
		clientVer,
		fetchFn = fetch,
		rateLimiter = defaultAnidbRateLimiter,
	} = deps;

	return {
		fetchTitle: async (serviceId) =>
			rateLimiter.run(async () => {
				const query = new URLSearchParams({
					aid: serviceId,
					client,
					clientver: clientVer,
					protover: "1",
					request: "anime",
				});
				const response = await fetchFn(`${baseUrl}?${query.toString()}`);
				if (!response.ok) {
					return;
				}
				const xml = await response.text();
				const root = parseXml(xml);
				const anime = animeNodeOf(root);
				if (anime === undefined) {
					return;
				}
				const title = anidbTitleOf(anime);
				if (title === undefined || title === "") {
					return;
				}
				const startDate = firstChild(anime, "startdate")?.text;
				const episodeCount = firstChild(anime, "episodecount")?.text;
				return {
					format: anidbFormatOf(firstChild(anime, "type")?.text),
					instalmentCount:
						episodeCount === undefined
							? undefined
							: Math.trunc(Number(episodeCount)),
					releaseDate: startDate,
					title,
				};
			}),
	};
};

interface BuildCatalogueClientsInput {
	readonly overrides?: Partial<{
		readonly simkl: SimklClient;
		readonly verification: VerificationClients;
	}>;
	readonly secrets: CatalogueSecrets;
}

interface CatalogueClients {
	readonly simkl: SimklClient | undefined;
	readonly verification: VerificationClients;
}

const buildCatalogueClients = (
	input: BuildCatalogueClientsInput,
): CatalogueClients => {
	const { overrides, secrets } = input;

	const verification: VerificationClients = {};
	if (secrets.TMDB_API_KEY !== undefined) {
		verification.tmdb = createTmdbVerificationClient({
			apiKey: secrets.TMDB_API_KEY,
		});
	}
	if (secrets.TVDB_API_KEY !== undefined) {
		verification.tvdb = createTvdbVerificationClient({
			apiKey: secrets.TVDB_API_KEY,
		});
	}
	if (
		secrets.ANIDB_CLIENT !== undefined &&
		secrets.ANIDB_CLIENT_VER !== undefined
	) {
		verification.anidb = createAnidbVerificationClient({
			client: secrets.ANIDB_CLIENT,
			clientVer: secrets.ANIDB_CLIENT_VER,
		});
	}

	return {
		simkl:
			overrides?.simkl ??
			(secrets.SIMKL_API_KEY === undefined
				? undefined
				: createSimklClient({ apiKey: secrets.SIMKL_API_KEY })),
		verification: overrides?.verification ?? verification,
	};
};

export {
	buildCatalogueClients,
	createAnidbVerificationClient,
	createTmdbVerificationClient,
	createTvdbVerificationClient,
};
export type {
	AnidbVerificationClientDeps,
	BuildCatalogueClientsInput,
	CatalogueClients,
	TmdbVerificationClientDeps,
	TvdbVerificationClientDeps,
};
