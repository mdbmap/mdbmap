import type { SyncAccountCredentials } from "@/lib/sync-accounts";
import type {
	MappedWatchStatus,
	SyncTargetClient,
	TargetWriteBatch,
} from "@/lib/sync-push/types.ts";

const DEFAULT_MAL_URL = "https://api.myanimelist.net/v2";
const DEFAULT_TIMEOUT_MS = 8000;

const malStatusOf = (status: MappedWatchStatus): string => {
	switch (status) {
		case "completed": {
			return "completed";
		}
		case "current": {
			return "watching";
		}
		case "dropped": {
			return "dropped";
		}
		case "on_hold": {
			return "on_hold";
		}
		case "planning": {
			return "plan_to_watch";
		}
		case "repeating": {
			return "watching";
		}
	}
};

interface TitlePatch {
	isRewatching?: boolean;
	numWatchedEpisodes?: number;
	score?: number;
	status?: string;
}

const patchesOf = (batch: TargetWriteBatch): Map<number, TitlePatch> => {
	const patches = new Map<number, TitlePatch>();
	const patchFor = (externalTitleId: string): TitlePatch => {
		const animeId = Number(externalTitleId);
		if (!Number.isInteger(animeId) || animeId <= 0) {
			throw new Error(`mal: invalid anime id ${externalTitleId}`);
		}
		const existing = patches.get(animeId);
		if (existing !== undefined) {
			return existing;
		}
		const created: TitlePatch = {};
		patches.set(animeId, created);
		return created;
	};

	for (const row of batch.status) {
		const patch = patchFor(row.externalTitleId);
		patch.status = malStatusOf(row.status);
		patch.isRewatching = row.status === "repeating";
	}
	for (const row of batch.progress) {
		if (!row.watched) {
			continue;
		}
		const patch = patchFor(row.externalTitleId);
		patch.numWatchedEpisodes = Math.max(
			patch.numWatchedEpisodes ?? 0,
			row.episode,
		);
	}
	for (const row of batch.ratings) {
		if (row.unit !== "title") {
			continue;
		}
		patchFor(row.externalTitleId).score = row.score;
	}
	return patches;
};

interface MalTargetClientDeps {
	readonly baseUrl?: string;
	readonly credentials: SyncAccountCredentials;
	readonly fetchFn?: typeof fetch;
	readonly timeoutMs?: number;
}

const putAnimeListStatus = async (
	fetchFn: typeof fetch,
	baseUrl: string,
	accessToken: string,
	timeoutMs: number,
	animeId: number,
	patch: TitlePatch,
): Promise<void> => {
	const body = new URLSearchParams();
	if (patch.status !== undefined) {
		body.set("status", patch.status);
	}
	if (patch.numWatchedEpisodes !== undefined) {
		body.set("num_watched_episodes", String(patch.numWatchedEpisodes));
	}
	if (patch.score !== undefined) {
		body.set("score", String(patch.score));
	}
	if (patch.isRewatching !== undefined) {
		body.set("is_rewatching", patch.isRewatching ? "true" : "false");
	}
	const response = await fetchFn(`${baseUrl}/anime/${animeId}/my_list_status`, {
		body,
		headers: {
			Authorization: `Bearer ${accessToken}`,
			"Content-Type": "application/x-www-form-urlencoded",
		},
		method: "PUT",
		signal: AbortSignal.timeout(timeoutMs),
	});
	if (!response.ok) {
		throw new Error(`mal: ${response.status} for anime ${animeId}`);
	}
};

const createMalTargetClient = (deps: MalTargetClientDeps): SyncTargetClient => {
	const {
		baseUrl = DEFAULT_MAL_URL,
		credentials,
		fetchFn = fetch,
		timeoutMs = DEFAULT_TIMEOUT_MS,
	} = deps;
	const { accessToken } = credentials;
	if (accessToken === undefined) {
		throw new Error("mal: access token is required");
	}

	return {
		provider: "mal",
		push: async (batch) => {
			await Promise.all(
				[...patchesOf(batch)].map(async ([animeId, patch]) =>
					putAnimeListStatus(
						fetchFn,
						baseUrl,
						accessToken,
						timeoutMs,
						animeId,
						patch,
					),
				),
			);
		},
	};
};

export { createMalTargetClient };
export type { MalTargetClientDeps };
