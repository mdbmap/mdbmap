import type { SyncAccountProvider, WatchStatus } from "@/db/schema";

import type { MappedWatchStatus } from "./types.ts";

const mapWatchStatus = (status: WatchStatus): MappedWatchStatus => {
	switch (status) {
		case "watching": {
			return "current";
		}
		case "on_hold": {
			return "on_hold";
		}
		case "completed": {
			return "completed";
		}
		case "dropped": {
			return "dropped";
		}
		case "rewatching": {
			return "repeating";
		}
	}
};

/** Personal scores are 1–10. AniList list scores are 0–100; others keep 1–10. */
const mapScore = (provider: SyncAccountProvider, score: number): number =>
	provider === "anilist" ? score * 10 : score;

export { mapScore, mapWatchStatus };
