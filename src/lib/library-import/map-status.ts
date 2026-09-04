import type { WatchStatus } from "@/db/schema";

import type { ImportListEntry } from "./types.ts";

const malStatusToWatchStatus = (status: string): WatchStatus | undefined => {
	switch (status) {
		case "watching": {
			return "watching";
		}
		case "completed": {
			return "completed";
		}
		case "on_hold": {
			return "on_hold";
		}
		case "dropped": {
			return "dropped";
		}
		case "rewatching": {
			return "rewatching";
		}
		case "plan_to_watch": {
			return undefined;
		}
		default: {
			return undefined;
		}
	}
};

const proposedStatusOf = (entry: ImportListEntry): WatchStatus | undefined =>
	malStatusToWatchStatus(entry.status);

const proposedScoreOf = (score: number | undefined): number | undefined => {
	if (score === undefined || score <= 0) {
		return undefined;
	}
	return score;
};

export { malStatusToWatchStatus, proposedScoreOf, proposedStatusOf };
