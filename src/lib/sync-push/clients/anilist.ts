import type { SyncAccountCredentials } from "@/lib/sync-accounts";
import type {
	MappedWatchStatus,
	SyncTargetClient,
	TargetWriteBatch,
} from "@/lib/sync-push/types.ts";

const DEFAULT_ANILIST_URL = "https://graphql.anilist.co";
const DEFAULT_TIMEOUT_MS = 8000;

const SAVE_MEDIA_LIST_ENTRY = `mutation ($mediaId: Int, $status: MediaListStatus, $progress: Int, $score: Float) {
  SaveMediaListEntry(mediaId: $mediaId, status: $status, progress: $progress, score: $score) {
    id
  }
}`;

const anilistStatusOf = (status: MappedWatchStatus): string => {
	switch (status) {
		case "completed": {
			return "COMPLETED";
		}
		case "current": {
			return "CURRENT";
		}
		case "dropped": {
			return "DROPPED";
		}
		case "on_hold": {
			return "PAUSED";
		}
		case "planning": {
			return "PLANNING";
		}
		case "repeating": {
			return "REPEATING";
		}
	}
};

interface TitlePatch {
	progress?: number;
	score?: number;
	status?: string;
}

const patchesOf = (batch: TargetWriteBatch): Map<number, TitlePatch> => {
	const patches = new Map<number, TitlePatch>();
	const patchFor = (externalTitleId: string): TitlePatch => {
		const mediaId = Number(externalTitleId);
		if (!Number.isInteger(mediaId) || mediaId <= 0) {
			throw new Error(`anilist: invalid media id ${externalTitleId}`);
		}
		const existing = patches.get(mediaId);
		if (existing !== undefined) {
			return existing;
		}
		const created: TitlePatch = {};
		patches.set(mediaId, created);
		return created;
	};

	for (const row of batch.status) {
		patchFor(row.externalTitleId).status = anilistStatusOf(row.status);
	}
	for (const row of batch.progress) {
		if (!row.watched) {
			continue;
		}
		const patch = patchFor(row.externalTitleId);
		patch.progress = Math.max(patch.progress ?? 0, row.episode);
	}
	for (const row of batch.ratings) {
		if (row.unit !== "title") {
			continue;
		}
		patchFor(row.externalTitleId).score = row.score;
	}
	return patches;
};

interface AnilistTargetClientDeps {
	readonly baseUrl?: string;
	readonly credentials: SyncAccountCredentials;
	readonly fetchFn?: typeof fetch;
	readonly timeoutMs?: number;
}

const saveMediaListEntry = async (
	fetchFn: typeof fetch,
	baseUrl: string,
	accessToken: string,
	timeoutMs: number,
	mediaId: number,
	patch: TitlePatch,
): Promise<void> => {
	const response = await fetchFn(baseUrl, {
		body: JSON.stringify({
			query: SAVE_MEDIA_LIST_ENTRY,
			variables: {
				mediaId,
				...(patch.progress === undefined ? {} : { progress: patch.progress }),
				...(patch.score === undefined ? {} : { score: patch.score }),
				...(patch.status === undefined ? {} : { status: patch.status }),
			},
		}),
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/json",
		},
		method: "POST",
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		throw new Error(`anilist: ${response.status} for media ${mediaId}`);
	}
	const body: unknown = await response.json();
	if (
		typeof body === "object" &&
		body !== null &&
		"errors" in body &&
		Array.isArray(body.errors) &&
		body.errors.length > 0
	) {
		throw new Error(`anilist: GraphQL error for media ${mediaId}`);
	}
};

const createAnilistTargetClient = (
	deps: AnilistTargetClientDeps,
): SyncTargetClient => {
	const {
		baseUrl = DEFAULT_ANILIST_URL,
		credentials,
		fetchFn = fetch,
		timeoutMs = DEFAULT_TIMEOUT_MS,
	} = deps;
	const { accessToken } = credentials;
	if (accessToken === undefined) {
		throw new Error("anilist: access token is required");
	}

	return {
		provider: "anilist",
		push: async (batch) => {
			await Promise.all(
				[...patchesOf(batch)].map(async ([mediaId, patch]) =>
					saveMediaListEntry(
						fetchFn,
						baseUrl,
						accessToken,
						timeoutMs,
						mediaId,
						patch,
					),
				),
			);
		},
	};
};

export { createAnilistTargetClient };
export type { AnilistTargetClientDeps };
