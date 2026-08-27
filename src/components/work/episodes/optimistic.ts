import { produce } from "immer";

import type {
	EpisodeWatchedResult,
	ViewerTracking,
	WorkView,
} from "@/orpc/schema";

const emptyViewer = (): ViewerTracking => ({
	personalRating: undefined,
	rewatchCount: 0,
	status: undefined,
	watched: [],
});

// Optimistic mirror of `tracking.setEpisodeWatched`: flip the listed row and the
// viewer's watched set (what the You block reads). The `completed` transition
// depends on unlisted instalments the client can't see, so it is left to the
// server result via `applyDerivedTracking`; only the `watching` start is mirrored.
function applyEpisodeWatched(
	work: WorkView,
	instalmentLocator: string,
	watched: boolean,
): WorkView {
	return produce(work, (draft) => {
		for (const part of draft.parts) {
			if (part.kind === "film") {
				if (part.instalmentLocator === instalmentLocator) {
					part.watched = watched;
				}
				continue;
			}
			for (const episode of part.episodes) {
				if (episode.instalmentLocator === instalmentLocator) {
					episode.watched = watched;
				}
			}
		}
		const viewer = draft.viewer ?? emptyViewer();
		const watchedSet = new Set(viewer.watched);
		if (watched) {
			watchedSet.add(instalmentLocator);
		} else {
			watchedSet.delete(instalmentLocator);
		}
		viewer.watched = [...watchedSet];
		if (viewer.status === undefined && watchedSet.size > 0) {
			viewer.status = "watching";
		}
		draft.viewer = viewer;
	});
}

// Reconcile against the server's derived whole-series result: the authoritative
// watched set and status replace the optimistic guess.
function applyDerivedTracking(
	work: WorkView,
	result: EpisodeWatchedResult,
): WorkView {
	return produce(work, (draft) => {
		const watchedSet = new Set(result.watched);
		for (const part of draft.parts) {
			if (part.kind === "film") {
				part.watched = watchedSet.has(part.instalmentLocator);
				continue;
			}
			for (const episode of part.episodes) {
				episode.watched = watchedSet.has(episode.instalmentLocator);
			}
		}
		draft.viewer = {
			personalRating: draft.viewer?.personalRating,
			rewatchCount: draft.viewer?.rewatchCount ?? 0,
			status: result.status,
			watched: result.watched,
		};
	});
}

export { applyDerivedTracking, applyEpisodeWatched };
