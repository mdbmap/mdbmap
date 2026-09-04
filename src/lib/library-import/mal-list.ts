import { z } from "zod";

import type { ImportListEntry } from "./types.ts";

const DEFAULT_MAL_URL = "https://api.myanimelist.net/v2";
const DEFAULT_TIMEOUT_MS = 15_000;
const PAGE_LIMIT = 100;

const MalListStatusSchema = z
	.object({
		is_rewatching: z.boolean().optional(),
		num_episodes_watched: z.number().int().nonnegative().optional(),
		score: z.number().int().min(0).max(10).optional(),
		status: z.string().min(1),
		updated_at: z.string().optional(),
	})
	.loose();

const MalAnimeNodeSchema = z
	.object({
		id: z.number().int().positive(),
		title: z.string().optional(),
	})
	.loose();

const MalListRowSchema = z
	.object({
		list_status: MalListStatusSchema,
		node: MalAnimeNodeSchema,
	})
	.loose();

const MalListPageSchema = z
	.object({
		data: z.array(MalListRowSchema),
		paging: z
			.object({
				next: z.url().optional(),
			})
			.optional(),
	})
	.loose();

interface FetchMalListInput {
	readonly accessToken: string;
	readonly baseUrl?: string;
	readonly fetchImpl?: typeof fetch;
	readonly timeoutMs?: number;
}

const entryOf = (row: z.infer<typeof MalListRowSchema>): ImportListEntry => {
	const rewatching = row.list_status.is_rewatching === true;
	return {
		externalTitleId: String(row.node.id),
		progress: row.list_status.num_episodes_watched,
		score: row.list_status.score,
		status: rewatching ? "rewatching" : row.list_status.status,
		title: row.node.title,
		updatedAt: row.list_status.updated_at,
	};
};

const fetchMalListPage = async (
	url: string,
	accessToken: string,
	fetchImpl: typeof fetch,
	timeoutMs: number,
): Promise<z.infer<typeof MalListPageSchema>> => {
	const response = await fetchImpl(url, {
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${accessToken}`,
		},
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		throw new Error(`mal: list fetch failed with ${response.status}`);
	}
	return MalListPageSchema.parse(await response.json());
};

const allowedNextUrl = (
	candidate: string | undefined,
	allowedOrigin: string,
): string | undefined => {
	if (candidate === undefined) {
		return undefined;
	}
	let next: URL;
	try {
		next = new URL(candidate);
	} catch {
		return undefined;
	}
	if (next.origin !== allowedOrigin) {
		return undefined;
	}
	return candidate;
};

const collectMalAnimeList = async (
	nextUrl: string | undefined,
	accessToken: string,
	fetchImpl: typeof fetch,
	timeoutMs: number,
	allowedOrigin: string,
	entries: ImportListEntry[],
): Promise<readonly ImportListEntry[]> => {
	if (nextUrl === undefined) {
		return entries;
	}
	const page = await fetchMalListPage(
		nextUrl,
		accessToken,
		fetchImpl,
		timeoutMs,
	);
	for (const row of page.data) {
		entries.push(entryOf(row));
	}
	return collectMalAnimeList(
		allowedNextUrl(page.paging?.next, allowedOrigin),
		accessToken,
		fetchImpl,
		timeoutMs,
		allowedOrigin,
		entries,
	);
};

const fetchMalAnimeList = async (
	input: FetchMalListInput,
): Promise<readonly ImportListEntry[]> => {
	const fetchImpl = input.fetchImpl ?? fetch;
	const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const baseUrl = input.baseUrl ?? DEFAULT_MAL_URL;
	const allowedOrigin = new URL(baseUrl).origin;
	const firstUrl = `${baseUrl}/users/@me/animelist?fields=list_status&limit=${String(PAGE_LIMIT)}&nsfw=true`;
	return collectMalAnimeList(
		firstUrl,
		input.accessToken,
		fetchImpl,
		timeoutMs,
		allowedOrigin,
		[],
	);
};

export { fetchMalAnimeList };
export type { FetchMalListInput };
