import type { ResolveResult } from "@/engine";
import { parseContinuityKey } from "@/engine/continuity/keys";
import {
	reorderByIds,
	selectPresentationOrder,
} from "@/engine/continuity/orders";
import type { Db } from "@/orpc/context";
import { FILM_LABEL } from "@/orpc/next-up";
import type { NextUpSegment } from "@/orpc/next-up";
import type { WorkMetadata } from "@/orpc/providers";

const segmentsForNextUp = (
	resolved: ResolveResult,
	metadata: WorkMetadata | undefined,
): NextUpSegment[] =>
	resolved.segments.map((segment, index) => {
		const segMeta = metadata?.segments[index];
		const episodes = segMeta?.episodes;
		return {
			instalments: segment.instalments,
			kind: segment.kind,
			label:
				segMeta?.label ??
				(segment.kind === "atomic" ? FILM_LABEL : `Part ${index + 1}`),
			...(episodes === undefined ? {} : { episodes }),
		};
	});

const orderedSegments = async (
	db: Db,
	resolved: ResolveResult,
	metadata: WorkMetadata | undefined,
): Promise<readonly NextUpSegment[]> => {
	const paired = segmentsForNextUp(resolved, metadata);
	if (paired.length <= 1) {
		return paired;
	}
	const continuityId = parseContinuityKey(resolved.continuityId);
	if (continuityId === undefined) {
		return paired;
	}
	const selected = await selectPresentationOrder(db, continuityId);
	const ordered = reorderByIds(
		paired,
		selected.releaseSegmentIds,
		selected.segmentIds,
	);
	return ordered.length > 0 ? ordered : paired;
};

export { orderedSegments };
