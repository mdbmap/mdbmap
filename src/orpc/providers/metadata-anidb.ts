import { z } from "zod";

import type { ResolveResult } from "@/engine";
import { env } from "@/env";
import type { Credit, Similar } from "@/orpc/schema";

import { offlineSample } from "./anidb-offline-sample.ts";
import { childrenNamed, firstChild, parseXml } from "./anidb-xml.ts";
import type { XmlNode } from "./anidb-xml.ts";
import type { MetadataKv } from "./metadata-tmdb.ts";
import { createRateLimiter } from "./rate-limit.ts";
import type { RateLimiter } from "./rate-limit.ts";
import type {
	EpisodeMetadata,
	MetadataProvider,
	SegmentMetadata,
	WorkMetadata,
} from "./types.ts";

// Real AniDB provider (#6). AniDB splits an anime into one entry per cour, so the
// engine hands one anidb id per segment; each is fetched (through the flood
// gate), the first supplies the work header and every entry supplies its own
// episodes. Results snapshot to KV split by volatility, and a snapshot hit
// performs zero upstream subrequests and never touches the rate limiter.

const SNAPSHOT_VERSION = 2;
const DEFAULT_BASE_URL = "http://api.anidb.net:9001/httpapi";
const DEFAULT_CORE_TTL_SECONDS = 604_800;
const DEFAULT_VOLATILE_TTL_SECONDS = 21_600;
const ANIDB_FLOOD_INTERVAL_MS = 2000;
const MAX_CAST = 30;
const MAX_GENRES = 8;
const MAX_SIMILAR = 12;
const REGULAR_EPISODE_TYPE = "1";
const YEAR_LENGTH = 4;

// AniDB creator `type` -> the staff role we display. "Animation Work" is handled
// separately as a studio; every other type is dropped.
const STAFF_ROLES = new Map<string, string>([
	["Direction", "Director"],
	["Original Work", "Original Creator"],
	["Series Composition", "Series Composition"],
	["Character Design", "Character Design"],
	["Music", "Music"],
]);
const STUDIO_ROLE = "Animation Work";

const emptyNode: XmlNode = { attrs: {}, children: [], tag: "", text: "" };

interface AnidbProviderDeps {
	client: string | undefined;
	clientVer: string | undefined;
	resolveKv: () => MetadataKv | Promise<MetadataKv>;
	baseUrl?: string;
	coreTtlSeconds?: number;
	fetchFn?: typeof fetch;
	rateLimiter?: RateLimiter;
	version?: number;
	volatileTtlSeconds?: number;
}

const creditSchema = z.object({
	name: z.string(),
	ref: z.string().optional(),
	role: z.string(),
});

const similarSchema = z.object({
	continuityId: z.string(),
	coverRef: z.string().optional(),
	title: z.string(),
});

const episodeSchema = z.object({
	airDate: z.string().optional(),
	number: z.number(),
	title: z.string(),
});

const coreSegmentSchema = z.object({
	label: z.string(),
	year: z.number().optional(),
});

const volatileSegmentSchema = z.object({
	airedFrom: z.string().optional(),
	airedTo: z.string().optional(),
	episodes: z.array(episodeSchema),
});

const coreSnapshotSchema = z.object({
	backdropRef: z.string().optional(),
	cast: z.array(creditSchema),
	coverRef: z.string().optional(),
	genres: z.array(z.string()),
	ifYouLiked: z.array(similarSchema),
	nativeTitle: z.string().optional(),
	productionStatus: z.string().optional(),
	runtimeMinutes: z.number().optional(),
	segments: z.array(coreSegmentSchema),
	staff: z.array(creditSchema),
	studios: z.array(z.string()),
	synopsis: z.string(),
	title: z.string(),
	version: z.number(),
});

const volatileSnapshotSchema = z.object({
	segments: z.array(volatileSegmentSchema),
	span: z.string(),
	version: z.number(),
});

type CoreSnapshot = z.infer<typeof coreSnapshotSchema>;
type VolatileSnapshot = z.infer<typeof volatileSnapshotSchema>;

interface AnimeEntry {
	airedFrom: string | undefined;
	airedTo: string | undefined;
	cast: Credit[];
	coverRef: string | undefined;
	episodes: EpisodeMetadata[];
	genres: string[];
	ifYouLiked: Similar[];
	nativeTitle: string | undefined;
	productionStatus: string | undefined;
	runtimeMinutes: number | undefined;
	staff: Credit[];
	studios: string[];
	synopsis: string;
	title: string;
	year: number | undefined;
}

interface Snapshots {
	core: CoreSnapshot;
	volatile: VolatileSnapshot;
}

const imageRef = (path: string): string | undefined =>
	path === "" ? undefined : `anidb:${path}`;

const yearOf = (date: string): number | undefined => {
	const head = date.slice(0, YEAR_LENGTH);
	if (head.length < YEAR_LENGTH) {
		return undefined;
	}
	const year = Number(head);
	return Number.isNaN(year) ? undefined : year;
};

const emptyToUndefined = (value: string): string | undefined =>
	value === "" ? undefined : value;

const positiveMinutes = (value: string | undefined): number | undefined => {
	if (value === undefined || value === "") {
		return undefined;
	}
	const minutes = Number(value);
	return Number.isFinite(minutes) && minutes > 0 ? minutes : undefined;
};

const uniqueGenres = (names: readonly string[]): string[] => {
	const seen = new Set<string>();
	const genres: string[] = [];
	for (const name of names) {
		const trimmed = name.trim();
		if (trimmed === "" || seen.has(trimmed)) {
			continue;
		}
		seen.add(trimmed);
		genres.push(trimmed);
		if (genres.length >= MAX_GENRES) {
			break;
		}
	}
	return genres;
};

const isInfoboxTag = (tag: XmlNode): boolean => tag.attrs["infobox"] === "true";

const tagNameOf = (tag: XmlNode): string =>
	firstChild(tag, "name")?.text ?? tag.text;

const normaliseGenres = (anime: XmlNode): string[] => {
	const tags = childrenNamed(firstChild(anime, "tags") ?? emptyNode, "tag");
	const infobox = tags.filter((tag) => isInfoboxTag(tag));
	const preferred = infobox.length > 0 ? infobox : tags;
	return uniqueGenres(preferred.map((tag) => tagNameOf(tag)));
};

const runtimeMinutesOf = (anime: XmlNode): number | undefined => {
	const animeLevel =
		positiveMinutes(firstChild(anime, "length")?.text) ??
		positiveMinutes(firstChild(anime, "runtime")?.text);
	if (animeLevel !== undefined) {
		return animeLevel;
	}
	let earliest: { length: number | undefined; number: number } | undefined;
	for (const episode of childrenNamed(
		firstChild(anime, "episodes") ?? emptyNode,
		"episode",
	)) {
		const epno = firstChild(episode, "epno");
		if (epno?.attrs["type"] !== REGULAR_EPISODE_TYPE) {
			continue;
		}
		const number = Number(epno.text);
		if (Number.isNaN(number)) {
			continue;
		}
		if (earliest !== undefined && number >= earliest.number) {
			continue;
		}
		earliest = {
			length: positiveMinutes(firstChild(episode, "length")?.text),
			number,
		};
	}
	return earliest?.length;
};

const segmentIds = (resolved: ResolveResult): string[] => {
	const ids: string[] = [];
	for (const segment of resolved.segments) {
		if (segment.members.anidb !== undefined) {
			ids.push(segment.members.anidb);
		}
	}
	return ids;
};

const keyFor = (
	kind: "core" | "volatile",
	version: number,
	primaryId: string,
) => `anidb:v${version}:${kind}:${primaryId}`;

const titleByType = (
	titles: readonly XmlNode[],
	type: string,
): string | undefined =>
	titles.find((title) => title.attrs["type"] === type)?.text;

const titleByLang = (
	titles: readonly XmlNode[],
	lang: string,
): string | undefined =>
	titles.find((title) => title.attrs["xml:lang"] === lang)?.text;

const displayTitle = (titles: readonly XmlNode[]): string =>
	titleByType(titles, "main") ??
	titleByLang(titles, "en") ??
	titles[0]?.text ??
	"Untitled work";

const normaliseCast = (anime: XmlNode): Credit[] => {
	const cast: Credit[] = [];
	for (const character of childrenNamed(
		firstChild(anime, "characters") ?? emptyNode,
		"character",
	)) {
		const seiyuu = firstChild(character, "seiyuu");
		if (seiyuu === undefined || seiyuu.text === "") {
			continue;
		}
		const { id: seiyuuId } = seiyuu.attrs;
		cast.push({
			name: seiyuu.text,
			ref: seiyuuId === undefined ? undefined : `anidb:creator:${seiyuuId}`,
			role: firstChild(character, "name")?.text ?? "",
		});
		if (cast.length >= MAX_CAST) {
			break;
		}
	}
	return cast;
};

const partitionCreators = (
	anime: XmlNode,
): { staff: Credit[]; studios: string[] } => {
	const staff: Credit[] = [];
	const studios: string[] = [];
	const seenStudios = new Set<string>();
	for (const creator of childrenNamed(
		firstChild(anime, "creators") ?? emptyNode,
		"name",
	)) {
		const type = creator.attrs["type"] ?? "";
		if (type === STUDIO_ROLE) {
			if (!seenStudios.has(creator.text)) {
				seenStudios.add(creator.text);
				studios.push(creator.text);
			}
			continue;
		}
		const role = STAFF_ROLES.get(type);
		if (role !== undefined) {
			const { id } = creator.attrs;
			staff.push({
				name: creator.text,
				ref: id === undefined ? undefined : `anidb:creator:${id}`,
				role,
			});
		}
	}
	return { staff, studios };
};

const normaliseSimilar = (anime: XmlNode): Similar[] =>
	childrenNamed(firstChild(anime, "similaranime") ?? emptyNode, "anime")
		.slice(0, MAX_SIMILAR)
		.map((entry) => ({
			continuityId: `anidb:${entry.attrs["id"] ?? ""}`,
			coverRef: undefined,
			title: entry.text,
		}));

const episodeTitle = (episode: XmlNode): string => {
	const titles = childrenNamed(episode, "title");
	return titleByLang(titles, "en") ?? titles[0]?.text ?? "";
};

const normaliseEpisodes = (anime: XmlNode): EpisodeMetadata[] => {
	const episodes: EpisodeMetadata[] = [];
	for (const episode of childrenNamed(
		firstChild(anime, "episodes") ?? emptyNode,
		"episode",
	)) {
		const epno = firstChild(episode, "epno");
		if (epno?.attrs["type"] !== REGULAR_EPISODE_TYPE) {
			continue;
		}
		const number = Number(epno.text);
		if (Number.isNaN(number)) {
			continue;
		}
		episodes.push({
			airDate: emptyToUndefined(firstChild(episode, "airdate")?.text ?? ""),
			number,
			title: episodeTitle(episode) || `Episode ${number}`,
		});
	}
	return episodes.toSorted((left, right) => left.number - right.number);
};

const parseAnime = (xml: string): AnimeEntry => {
	const anime = parseXml(xml);
	const titles = childrenNamed(
		firstChild(anime, "titles") ?? emptyNode,
		"title",
	);
	const title = displayTitle(titles);
	const nativeTitle = titleByLang(titles, "ja");
	const startDate = firstChild(anime, "startdate")?.text ?? "";
	const { staff, studios } = partitionCreators(anime);
	return {
		airedFrom: emptyToUndefined(startDate),
		airedTo: emptyToUndefined(firstChild(anime, "enddate")?.text ?? ""),
		cast: normaliseCast(anime),
		coverRef: imageRef(firstChild(anime, "picture")?.text ?? ""),
		episodes: normaliseEpisodes(anime),
		genres: normaliseGenres(anime),
		ifYouLiked: normaliseSimilar(anime),
		nativeTitle: nativeTitle === title ? undefined : nativeTitle,
		productionStatus: undefined,
		runtimeMinutes: runtimeMinutesOf(anime),
		staff,
		studios,
		synopsis: firstChild(anime, "description")?.text ?? "",
		title,
		year: startDate === "" ? undefined : yearOf(startDate),
	};
};

const spanOf = (entries: readonly AnimeEntry[]): string => {
	const from = entries[0]?.year;
	if (from === undefined) {
		return "";
	}
	const lastEnd = entries.at(-1)?.airedTo;
	const to = lastEnd === undefined ? entries.at(-1)?.year : yearOf(lastEnd);
	return to === undefined || to === from ? `${from}` : `${from}–${to}`;
};

const buildSnapshots = (
	version: number,
	entries: readonly AnimeEntry[],
): Snapshots => {
	const [head] = entries;
	const core = coreSnapshotSchema.parse({
		backdropRef: undefined,
		cast: head?.cast ?? [],
		coverRef: head?.coverRef,
		genres: head?.genres ?? [],
		ifYouLiked: head?.ifYouLiked ?? [],
		nativeTitle: head?.nativeTitle,
		productionStatus: head?.productionStatus,
		runtimeMinutes: head?.runtimeMinutes,
		segments: entries.map((entry) => ({
			label: entry.title,
			year: entry.year,
		})),
		staff: head?.staff ?? [],
		studios: head?.studios ?? [],
		synopsis: head?.synopsis ?? "",
		title: head?.title ?? "Untitled work",
		version,
	});
	const volatile = volatileSnapshotSchema.parse({
		segments: entries.map((entry) => ({
			airedFrom: entry.airedFrom,
			airedTo: entry.airedTo,
			episodes: entry.episodes,
		})),
		span: spanOf(entries),
		version,
	});
	return { core, volatile };
};

const toCredit = (credit: CoreSnapshot["cast"][number]): Credit => ({
	name: credit.name,
	ref: credit.ref,
	role: credit.role,
});

const toEpisode = (
	episode: VolatileSnapshot["segments"][number]["episodes"][number],
): EpisodeMetadata => ({
	airDate: episode.airDate,
	number: episode.number,
	title: episode.title,
});

const assemble = (
	core: CoreSnapshot,
	volatile: VolatileSnapshot,
): WorkMetadata => {
	const segments: SegmentMetadata[] = core.segments.map(
		(coreSegment, index) => {
			const volatileSegment = volatile.segments[index];
			return {
				airedFrom: volatileSegment?.airedFrom,
				airedTo: volatileSegment?.airedTo,
				episodes: (volatileSegment?.episodes ?? []).map((episode) =>
					toEpisode(episode),
				),
				label: coreSegment.label,
				year: coreSegment.year,
			};
		},
	);
	return {
		backdropRef: core.backdropRef,
		cast: core.cast.map((credit) => toCredit(credit)),
		coverRef: core.coverRef,
		genres: [...core.genres],
		ifYouLiked: core.ifYouLiked.map((similar) => ({
			continuityId: similar.continuityId,
			coverRef: similar.coverRef,
			title: similar.title,
		})),
		nativeTitle: core.nativeTitle,
		productionStatus: core.productionStatus,
		runtimeMinutes: core.runtimeMinutes,
		segments,
		span: volatile.span,
		staff: core.staff.map((credit) => toCredit(credit)),
		studios: [...core.studios],
		synopsis: core.synopsis,
		title: core.title,
	};
};

const readSnapshot = async <Schema extends z.ZodType<{ version: number }>>(
	kv: MetadataKv,
	key: string,
	schema: Schema,
	version: number,
): Promise<z.infer<Schema> | undefined> => {
	const text = await kv.get(key);
	if (text === undefined) {
		return undefined;
	}
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		return undefined;
	}
	const result = schema.safeParse(raw);
	if (!result.success || result.data.version !== version) {
		return undefined;
	}
	return result.data;
};

interface HttpContext {
	baseUrl: string;
	client: string | undefined;
	clientVer: string | undefined;
	fetchFn: typeof fetch;
	rateLimiter: RateLimiter;
}

const fetchAnime = async (
	http: HttpContext,
	aid: string,
): Promise<AnimeEntry> => {
	if (http.client === undefined || http.clientVer === undefined) {
		throw new Error(
			"anidb: ANIDB_CLIENT and ANIDB_CLIENT_VER are not configured",
		);
	}
	const query = new URLSearchParams({
		aid,
		client: http.client,
		clientver: http.clientVer,
		protover: "1",
		request: "anime",
	});
	const xml = await http.rateLimiter.run(async () => {
		const response = await http.fetchFn(`${http.baseUrl}?${query.toString()}`);
		if (!response.ok) {
			throw new Error(`anidb: ${response.status} for aid ${aid}`);
		}
		return response.text();
	});
	return parseAnime(xml);
};

const createAnidbProvider = (deps: AnidbProviderDeps): MetadataProvider => {
	const {
		client,
		clientVer,
		resolveKv,
		baseUrl = DEFAULT_BASE_URL,
		coreTtlSeconds = DEFAULT_CORE_TTL_SECONDS,
		fetchFn = fetch,
		rateLimiter = createRateLimiter({ intervalMs: ANIDB_FLOOD_INTERVAL_MS }),
		version = SNAPSHOT_VERSION,
		volatileTtlSeconds = DEFAULT_VOLATILE_TTL_SECONDS,
	} = deps;
	const http: HttpContext = {
		baseUrl,
		client,
		clientVer,
		fetchFn,
		rateLimiter,
	};

	const fetchWork = async (resolved: ResolveResult): Promise<WorkMetadata> => {
		const ids = segmentIds(resolved);
		const [primaryId] = ids;
		if (primaryId === undefined) {
			throw new Error("anidb: resolved members carry no anidb id");
		}
		if (client === undefined || clientVer === undefined) {
			return offlineSample(resolved);
		}
		const kv = await resolveKv();
		const coreKey = keyFor("core", version, primaryId);
		const volatileKey = keyFor("volatile", version, primaryId);

		const core = await readSnapshot(kv, coreKey, coreSnapshotSchema, version);
		const volatile = await readSnapshot(
			kv,
			volatileKey,
			volatileSnapshotSchema,
			version,
		);
		if (core !== undefined && volatile !== undefined) {
			return assemble(core, volatile);
		}

		const entries = await Promise.all(
			ids.map(async (id) => {
				const entry = await fetchAnime(http, id);
				return entry;
			}),
		);
		const fetched = buildSnapshots(version, entries);
		await kv.put(coreKey, JSON.stringify(fetched.core), {
			expirationTtl: coreTtlSeconds,
		});
		await kv.put(volatileKey, JSON.stringify(fetched.volatile), {
			expirationTtl: volatileTtlSeconds,
		});
		return assemble(fetched.core, fetched.volatile);
	};

	return { fetchWork };
};

const resolveMetadataKv = async (): Promise<MetadataKv> => {
	const { env: workerEnv } = await import("cloudflare:workers");
	const namespace = workerEnv.METADATA_KV;
	return {
		get: async (key) => (await namespace.get(key)) ?? undefined,
		put: async (key, value, options) => {
			await namespace.put(key, value, options);
		},
	};
};

// Registered under the name metadata.ts imports (that file is left untouched).
// The real provider fetches live AniDB when credentials are set and falls back
// to bundled sample metadata otherwise.
const anidbStubProvider = createAnidbProvider({
	client: env.ANIDB_CLIENT,
	clientVer: env.ANIDB_CLIENT_VER,
	resolveKv: resolveMetadataKv,
});

export { anidbStubProvider, createAnidbProvider };
export type { AnidbProviderDeps };
