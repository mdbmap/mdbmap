import { produce } from "immer";

import type { WatchStatus } from "@/db/schema";
import type { RateableUnit, ViewerTracking, WorkView } from "@/orpc/schema";

const emptyViewer = (): ViewerTracking => ({
	personalRating: undefined,
	rewatchCount: 0,
	status: undefined,
	watched: [],
});

// Optimistic mirror of `tracking.setStatus`: `work.get` is the single read seam,
// so the You block reads its cached viewer. The server echoes the input, so the
// patch is authoritative until the settle refetch.
function applyStatus(work: WorkView, status: WatchStatus): WorkView {
	return produce(work, (draft) => {
		const viewer = draft.viewer ?? emptyViewer();
		viewer.status = status;
		draft.viewer = viewer;
	});
}

function applyRewatch(work: WorkView, count: number): WorkView {
	return produce(work, (draft) => {
		const viewer = draft.viewer ?? emptyViewer();
		viewer.rewatchCount = count;
		draft.viewer = viewer;
	});
}

// The work score lives on the viewer block, a part/film score on its block, and
// an episode score on the nested row; one reducer mirrors all by unit kind.
function applyRating(
	work: WorkView,
	unit: RateableUnit,
	score: number | undefined,
): WorkView {
	return produce(work, (draft) => {
		if (unit.kind === "work") {
			const viewer = draft.viewer ?? emptyViewer();
			viewer.personalRating = score;
			draft.viewer = viewer;
			return;
		}
		if (unit.kind === "episode") {
			for (const part of draft.parts) {
				if (part.kind !== "part") {
					continue;
				}
				for (const episode of part.episodes) {
					if (episode.rateableUnit.key === unit.key) {
						episode.personalRating = score;
					}
				}
			}
			return;
		}
		for (const part of draft.parts) {
			if (
				part.rateableUnit.kind === unit.kind &&
				part.rateableUnit.key === unit.key
			) {
				part.personalRating = score;
			}
		}
	});
}

export { applyRating, applyRewatch, applyStatus };
