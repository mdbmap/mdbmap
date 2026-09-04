import type { WatchStatus } from "@/db/schema";
import type { NextUp } from "@/orpc/schema";

interface NextUpEpisode {
	readonly number: number;
	readonly title: string;
}

interface NextUpSegment {
	readonly episodes?: readonly NextUpEpisode[];
	readonly instalments: readonly string[];
	readonly kind: "atomic" | "episodic";
	readonly label?: string;
}

const FILM_LABEL = "Film";

const nextUp = (
	status: WatchStatus,
	segments: readonly NextUpSegment[],
	watched: ReadonlySet<string>,
): NextUp | undefined => {
	if (status === "completed") {
		return undefined;
	}
	for (const [segmentIndex, segment] of segments.entries()) {
		for (const [position, locator] of segment.instalments.entries()) {
			if (watched.has(locator)) {
				continue;
			}
			if (segment.kind === "atomic") {
				return {
					number: 1,
					partLabel: FILM_LABEL,
					title: segment.label ?? FILM_LABEL,
				};
			}
			const episode = segment.episodes?.[position];
			const number = episode?.number ?? position + 1;
			return {
				number,
				partLabel: segment.label ?? `Part ${segmentIndex + 1}`,
				title: episode?.title ?? `Episode ${number}`,
			};
		}
	}
	return undefined;
};

export { FILM_LABEL, nextUp };
export type { NextUpSegment };
