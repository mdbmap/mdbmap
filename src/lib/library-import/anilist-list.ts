import { z } from "zod";

import { SCORE_FORMATS, scoreOf } from "./anilist-score.ts";
import type { ScoreFormat } from "./anilist-score.ts";
import type { ImportListEntry } from "./types.ts";

const DEFAULT_ANILIST_URL = "https://graphql.anilist.co";
const DEFAULT_TIMEOUT_MS = 15_000;

const VIEWER_QUERY = `query {
  Viewer {
    id
    mediaListOptions { scoreFormat }
  }
}`;

const MEDIA_LIST_COLLECTION_QUERY = `query ($userId: Int) {
  MediaListCollection(userId: $userId, type: ANIME) {
    lists {
      isCustomList
      entries {
        progress
        score
        status
        updatedAt
        media {
          id
          title { userPreferred }
        }
      }
    }
  }
}`;

const PositiveIntSchema = z.number().int().positive();
const NonNegativeIntSchema = z.number().int().nonnegative();
const GraphqlErrorSchema = z.object({ message: z.string() }).loose();
const GraphqlErrorsSchema = z.array(GraphqlErrorSchema).optional();

const ScoreFormatSchema = z.enum(SCORE_FORMATS);
const ViewerSchema = z
	.object({
		id: PositiveIntSchema,
		mediaListOptions: z
			.object({ scoreFormat: ScoreFormatSchema.nullable().optional() })
			.loose()
			.nullable()
			.optional(),
	})
	.nullable();
const ViewerDataSchema = z.object({ Viewer: ViewerSchema }).optional();
const ViewerResponseSchema = z
	.object({
		data: ViewerDataSchema,
		errors: GraphqlErrorsSchema,
	})
	.loose();

const MediaTitleSchema = z
	.object({
		userPreferred: z.string().nullable().optional(),
	})
	.loose()
	.nullable()
	.optional();

const MediaNodeSchema = z
	.object({
		id: PositiveIntSchema,
		title: MediaTitleSchema,
	})
	.loose()
	.nullable();

const MediaListEntrySchema = z
	.object({
		media: MediaNodeSchema,
		progress: NonNegativeIntSchema.nullable().optional(),
		score: z.number().nullable().optional(),
		status: z.string().nullable().optional(),
		updatedAt: z.number().int().nullable().optional(),
	})
	.loose();

const MediaListEntriesSchema = z.array(MediaListEntrySchema).nullable();
const MediaListBucketSchema = z
	.object({
		entries: MediaListEntriesSchema,
		isCustomList: z.boolean().nullable().optional(),
	})
	.loose();
const MediaListBucketsSchema = z.array(MediaListBucketSchema).nullable();
const MediaListCollectionNodeSchema = z
	.object({
		lists: MediaListBucketsSchema,
	})
	.nullable()
	.optional();
const MediaListCollectionDataSchema = z
	.object({
		MediaListCollection: MediaListCollectionNodeSchema,
	})
	.optional();
const MediaListCollectionSchema = z
	.object({
		data: MediaListCollectionDataSchema,
		errors: GraphqlErrorsSchema,
	})
	.loose();

interface FetchAnilistListInput {
	readonly accessToken: string;
	readonly baseUrl?: string;
	readonly fetchImpl?: typeof fetch;
	readonly timeoutMs?: number;
}

const anilistStatusOf = (status: string | null | undefined): string => {
	if (status === null || status === undefined) {
		return "unknown";
	}
	switch (status) {
		case "CURRENT": {
			return "watching";
		}
		case "COMPLETED": {
			return "completed";
		}
		case "PAUSED": {
			return "on_hold";
		}
		case "DROPPED": {
			return "dropped";
		}
		case "REPEATING": {
			return "rewatching";
		}
		case "PLANNING": {
			return "plan_to_watch";
		}
		default: {
			return status;
		}
	}
};

const updatedAtOf = (
	updatedAt: number | null | undefined,
): string | undefined => {
	if (updatedAt === null || updatedAt === undefined || updatedAt <= 0) {
		return undefined;
	}
	return new Date(updatedAt * 1000).toISOString();
};

const entryOf = (
	row: z.infer<typeof MediaListEntrySchema>,
	scoreFormat: ScoreFormat | undefined,
): ImportListEntry | undefined => {
	const mediaId = row.media?.id;
	if (mediaId === undefined) {
		return undefined;
	}
	return {
		externalTitleId: String(mediaId),
		progress: row.progress ?? undefined,
		score: scoreOf(row.score ?? undefined, scoreFormat),
		status: anilistStatusOf(row.status),
		title: row.media?.title?.userPreferred ?? undefined,
		updatedAt: updatedAtOf(row.updatedAt),
	};
};

const graphql = async (
	fetchImpl: typeof fetch,
	baseUrl: string,
	accessToken: string,
	timeoutMs: number,
	query: string,
	variables?: Record<string, unknown>,
): Promise<unknown> => {
	const response = await fetchImpl(baseUrl, {
		body: JSON.stringify({
			query,
			...(variables === undefined ? {} : { variables }),
		}),
		headers: {
			Accept: "application/json",
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		method: "POST",
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		throw new Error(`anilist: list fetch failed with ${response.status}`);
	}
	return response.json();
};

interface ViewerIdentity {
	readonly scoreFormat: ScoreFormat | undefined;
	readonly userId: number;
}

const resolveViewer = async (
	fetchImpl: typeof fetch,
	baseUrl: string,
	accessToken: string,
	timeoutMs: number,
): Promise<ViewerIdentity> => {
	const raw = await graphql(
		fetchImpl,
		baseUrl,
		accessToken,
		timeoutMs,
		VIEWER_QUERY,
	);
	const parsed = ViewerResponseSchema.parse(raw);
	if (parsed.errors !== undefined && parsed.errors.length > 0) {
		throw new Error(`anilist: ${parsed.errors[0]?.message ?? "GraphQL error"}`);
	}
	const viewer = parsed.data?.Viewer;
	const userId = viewer?.id;
	if (userId === undefined) {
		throw new Error("anilist: viewer id missing");
	}
	const format = viewer?.mediaListOptions?.scoreFormat;
	return {
		scoreFormat: format ?? undefined,
		userId,
	};
};

const fetchAnilistAnimeList = async (
	input: FetchAnilistListInput,
): Promise<readonly ImportListEntry[]> => {
	const fetchImpl = input.fetchImpl ?? fetch;
	const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const baseUrl = input.baseUrl ?? DEFAULT_ANILIST_URL;
	const viewer = await resolveViewer(
		fetchImpl,
		baseUrl,
		input.accessToken,
		timeoutMs,
	);
	const raw = await graphql(
		fetchImpl,
		baseUrl,
		input.accessToken,
		timeoutMs,
		MEDIA_LIST_COLLECTION_QUERY,
		{ userId: viewer.userId },
	);
	const parsed = MediaListCollectionSchema.parse(raw);
	if (parsed.errors !== undefined && parsed.errors.length > 0) {
		throw new Error(`anilist: ${parsed.errors[0]?.message ?? "GraphQL error"}`);
	}

	const entries: ImportListEntry[] = [];
	const seen = new Set<string>();
	for (const list of parsed.data?.MediaListCollection?.lists ?? []) {
		if (list.isCustomList === true) {
			continue;
		}
		for (const row of list.entries ?? []) {
			const entry = entryOf(row, viewer.scoreFormat);
			if (entry === undefined || seen.has(entry.externalTitleId)) {
				continue;
			}
			seen.add(entry.externalTitleId);
			entries.push(entry);
		}
	}
	return entries;
};

export { fetchAnilistAnimeList };
export type { FetchAnilistListInput };
