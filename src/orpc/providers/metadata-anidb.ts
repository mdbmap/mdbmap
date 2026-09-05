import { resolveDb } from "@/db";
import type { ResolveResult } from "@/engine";
import { env } from "@/env";
import type { Credit, Similar } from "@/orpc/schema";

import { offlineSample } from "./anidb-offline-sample.ts";
import { childrenNamed, firstChild, parseXml } from "./anidb-xml.ts";
import type { XmlNode } from "./anidb-xml.ts";
import {
	assemble,
	coreSnapshotSchema,
	volatileSnapshotSchema,
} from "./metadata-document.ts";
import type { Snapshots } from "./metadata-document.ts";
import type { MetadataFetchOptions } from "./metadata-freshness.ts";
import { freshnessClassOf } from "./metadata-freshness.ts";
import {
	lastUpdatedIso,
	resolveCatalogueDocument,
	settleDocuments,
} from "./metadata-load.ts";
import type { LocalizedTitle } from "./metadata-locale.ts";
import { createD1MetadataStore } from "./metadata-store.ts";
import type { MetadataStore } from "./metadata-store.ts";
import { createRateLimiter } from "./rate-limit.ts";
import type { RateLimiter } from "./rate-limit.ts";
import type {
	EpisodeMetadata,
	MetadataProvider,
	SegmentMetadata,
	WorkMetadata,
} from "./types.ts";

const SNAPSHOT_VERSION = 4;
const DEFAULT_BASE_URL = "http://api.anidb.net:9001/httpapi";
const ANIDB_FLOOD_INTERVAL_MS = 2000;
const MAX_CAST = 30;
const MAX_GENRES = 8;
const MAX_SIMILAR = 12;
const REGULAR_EPISODE_TYPE = "1";
const YEAR_LENGTH = 4;
const DEFAULT_LOCALE = "en";

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
	resolveStore: () => MetadataStore | Promise<MetadataStore>;
	baseUrl?: string;
	fetchFn?: typeof fetch;
	rateLimiter?: RateLimiter;
	version?: number;
}

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
	titles: LocalizedTitle[];
	year: number | undefined;
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

const xmlTitles = (node: XmlNode, tag = "title"): LocalizedTitle[] =>
	childrenNamed(node, tag)
		.filter((title) => title.text !== "")
		.map((title) => ({
			locale: title.attrs["xml:lang"] ?? "und",
			text: title.text,
			type: title.attrs["type"],
		}));

const titleByType = (
	titles: readonly LocalizedTitle[],
	type: string,
): string | undefined => titles.find((title) => title.type === type)?.text;

const titleByLang = (
	titles: readonly LocalizedTitle[],
	lang: string,
): string | undefined => titles.find((title) => title.locale === lang)?.text;

const displayTitle = (titles: readonly LocalizedTitle[]): string =>
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

const normaliseGenres = (anime: XmlNode): string[] => {
	const genres: string[] = [];
	const seen = new Set<string>();
	const add = (name: string) => {
		const trimmed = name.trim();
		if (trimmed === "" || seen.has(trimmed) || genres.length >= MAX_GENRES) {
			return;
		}
		seen.add(trimmed);
		genres.push(trimmed);
	};
	for (const tag of childrenNamed(
		firstChild(anime, "tags") ?? emptyNode,
		"tag",
	)) {
		if (tag.attrs["infobox"] !== "true" || tag.attrs["weight"] === "0") {
			continue;
		}
		add(firstChild(tag, "name")?.text ?? tag.text);
	}
	for (const category of childrenNamed(
		firstChild(anime, "categories") ?? emptyNode,
		"category",
	)) {
		if (category.attrs["infobox"] !== "true") {
			continue;
		}
		add(firstChild(category, "name")?.text ?? category.text);
	}
	return genres;
};

const episodeTitleList = (episode: XmlNode): LocalizedTitle[] =>
	xmlTitles(episode);

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
		const titles = episodeTitleList(episode);
		episodes.push({
			airDate: emptyToUndefined(firstChild(episode, "airdate")?.text ?? ""),
			number,
			title:
				titleByLang(titles, "en") ?? titles[0]?.text ?? `Episode ${number}`,
			titles,
		});
	}
	return episodes.toSorted((left, right) => left.number - right.number);
};

const productionLabel = (
	airedFrom: string | undefined,
	airedTo: string | undefined,
	now: Date,
): string => {
	const freshnessClass = freshnessClassOf(
		{ airedFrom, airedTo, productionStatus: undefined },
		now,
	);
	if (freshnessClass === "upcoming") {
		return "Upcoming";
	}
	if (freshnessClass === "continuing") {
		return "Airing";
	}
	return "Finished";
};

const parseAnime = (xml: string, now: Date): AnimeEntry => {
	const anime = parseXml(xml);
	const titles = xmlTitles(firstChild(anime, "titles") ?? emptyNode);
	const title = displayTitle(titles);
	const nativeTitle = titleByLang(titles, "ja");
	const startDate = firstChild(anime, "startdate")?.text ?? "";
	const endDate = firstChild(anime, "enddate")?.text ?? "";
	const { staff, studios } = partitionCreators(anime);
	const airedFrom = emptyToUndefined(startDate);
	const airedTo = emptyToUndefined(endDate);
	return {
		airedFrom,
		airedTo,
		cast: normaliseCast(anime),
		coverRef: imageRef(firstChild(anime, "picture")?.text ?? ""),
		episodes: normaliseEpisodes(anime),
		genres: normaliseGenres(anime),
		ifYouLiked: normaliseSimilar(anime),
		nativeTitle: nativeTitle === title ? undefined : nativeTitle,
		productionStatus: productionLabel(airedFrom, airedTo, now),
		runtimeMinutes: runtimeMinutesOf(anime),
		staff,
		studios,
		synopsis: firstChild(anime, "description")?.text ?? "",
		title,
		titles,
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

const buildSnapshots = (version: number, entry: AnimeEntry): Snapshots => {
	const localized = entry.titles
		.filter((title) => title.text !== "")
		.map((title) => ({
			locale: title.locale === "x-jat" ? "en" : title.locale,
			synopsis: entry.synopsis,
			title: title.text,
		}));
	const core = coreSnapshotSchema.parse({
		backdropRef: undefined,
		cast: entry.cast,
		coverRef: entry.coverRef,
		genres: entry.genres,
		ifYouLiked: entry.ifYouLiked,
		localized,
		nativeTitle: entry.nativeTitle,
		productionStatus: entry.productionStatus,
		runtimeMinutes: entry.runtimeMinutes,
		segments: [
			{
				label: entry.title,
				labelTitles: entry.titles,
				year: entry.year,
			},
		],
		staff: entry.staff,
		studios: entry.studios,
		synopsis: entry.synopsis,
		title: entry.title,
		titles: entry.titles,
		version,
	});
	const volatile = volatileSnapshotSchema.parse({
		segments: [
			{
				airedFrom: entry.airedFrom,
				airedTo: entry.airedTo,
				episodes: entry.episodes,
			},
		],
		span: spanOf([entry]),
		version,
	});
	return { core, volatile };
};

const emptySegment = (): SegmentMetadata => ({
	airedFrom: undefined,
	airedTo: undefined,
	episodes: [],
	label: undefined,
	year: undefined,
});

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
	now: Date,
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
	return parseAnime(xml, now);
};

const createAnidbProvider = (deps: AnidbProviderDeps): MetadataProvider => {
	const {
		client,
		clientVer,
		resolveStore,
		baseUrl = DEFAULT_BASE_URL,
		fetchFn = fetch,
		rateLimiter = createRateLimiter({ intervalMs: ANIDB_FLOOD_INTERVAL_MS }),
		version = SNAPSHOT_VERSION,
	} = deps;
	const http: HttpContext = {
		baseUrl,
		client,
		clientVer,
		fetchFn,
		rateLimiter,
	};

	const fetchWork = async (
		resolved: ResolveResult,
		options: MetadataFetchOptions = {},
	): Promise<WorkMetadata> => {
		const ids = segmentIds(resolved);
		const [primaryId] = ids;
		if (primaryId === undefined) {
			throw new Error("anidb: resolved members carry no anidb id");
		}
		if (client === undefined || clientVer === undefined) {
			return offlineSample(resolved);
		}
		const locale = options.locale ?? DEFAULT_LOCALE;
		const now = options.now ?? new Date();
		const store = await resolveStore();
		const documentsById = await settleDocuments(
			ids.map((id) => ({
				key: id,
				load: async () =>
					resolveCatalogueDocument({
						entryKey: id,
						fetchSnapshots: async () => {
							const entry = await fetchAnime(http, id, now);
							return buildSnapshots(version, entry);
						},
						now,
						options,
						provider: "anidb",
						store,
						version,
					}),
			})),
		);
		const documents = ids.flatMap((id) => {
			const document = documentsById.get(id);
			return document === undefined ? [] : [document];
		});
		const [identityDocument] = documents;
		if (identityDocument === undefined) {
			throw new Error("anidb: metadata snapshot run is missing");
		}
		const identity = assemble(
			identityDocument.snapshots.core,
			identityDocument.snapshots.volatile,
			locale,
		);
		const aligned: SegmentMetadata[] = resolved.segments.map((segment) => {
			const id = segment.members.anidb;
			if (id === undefined) {
				return emptySegment();
			}
			const document = documentsById.get(id);
			if (document === undefined) {
				return emptySegment();
			}
			const [part] = assemble(
				document.snapshots.core,
				document.snapshots.volatile,
				locale,
			).segments;
			return part ?? emptySegment();
		});
		const years = aligned
			.map((segment) => segment.year)
			.filter((year): year is number => year !== undefined);
		const [from] = years;
		const to = years.at(-1);
		let { span } = identity;
		if (from !== undefined) {
			span = to === undefined || to === from ? `${from}` : `${from}–${to}`;
		}
		return {
			...identity,
			lastUpdatedAt: lastUpdatedIso(documents),
			segments: aligned,
			span,
		};
	};

	return { fetchWork };
};

const resolveMetadataStore = async (): Promise<MetadataStore> =>
	createD1MetadataStore(await resolveDb());

const anidbStubProvider = createAnidbProvider({
	client: env.ANIDB_CLIENT,
	clientVer: env.ANIDB_CLIENT_VER,
	resolveStore: resolveMetadataStore,
});

export { anidbStubProvider, createAnidbProvider };
export type { AnidbProviderDeps };
