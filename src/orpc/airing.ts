const FILM_LABEL = "Film";
const WINDOW_DAYS = 13;

interface AiringEpisodeMeta {
	readonly airDate: string | undefined;
	readonly number: number;
	readonly title: string;
}

interface AiringSegment {
	readonly airedFrom: string | undefined;
	readonly episodes: readonly AiringEpisodeMeta[] | undefined;
	readonly instalments: readonly string[];
	readonly kind: "atomic" | "episodic";
	readonly label: string | undefined;
}

interface AiringWork {
	readonly continuityId: string;
	readonly segments: readonly AiringSegment[];
	readonly title: string;
	readonly watched: ReadonlySet<string>;
}

interface AiringEpisode {
	airDate: string;
	continuityId: string;
	number: number;
	partLabel: string;
	title: string;
	workTitle: string;
}

interface AiringDay {
	date: string;
	episodes: AiringEpisode[];
}

const isoDay = (value: Date): string => value.toISOString().slice(0, 10);

const addUtcDays = (day: string, days: number): string => {
	const date = new Date(`${day}T00:00:00.000Z`);
	date.setUTCDate(date.getUTCDate() + days);
	return isoDay(date);
};

const airDateOf = (
	segment: AiringSegment,
	position: number,
): string | undefined => {
	const episode = segment.episodes?.[position];
	return (
		episode?.airDate ??
		(segment.kind === "atomic" ? segment.airedFrom : undefined)
	);
};

const partLabelOf = (segment: AiringSegment, index: number): string => {
	if (segment.label !== undefined && segment.label !== "") {
		return segment.label;
	}
	return segment.kind === "atomic" ? FILM_LABEL : `Part ${index + 1}`;
};

const collectAiring = (
	works: readonly AiringWork[],
	fromDay: string,
	untilDay: string,
): AiringEpisode[] => {
	const items: AiringEpisode[] = [];
	for (const work of works) {
		for (const [segmentIndex, segment] of work.segments.entries()) {
			const partLabel = partLabelOf(segment, segmentIndex);
			for (const [position, locator] of segment.instalments.entries()) {
				if (work.watched.has(locator)) {
					continue;
				}
				const airDate = airDateOf(segment, position);
				if (airDate === undefined || airDate < fromDay || airDate > untilDay) {
					continue;
				}
				const episode = segment.episodes?.[position];
				const number =
					episode?.number ?? (segment.kind === "atomic" ? 1 : position + 1);
				items.push({
					airDate,
					continuityId: work.continuityId,
					number,
					partLabel,
					title:
						episode?.title ??
						(segment.kind === "atomic" ? partLabel : `Episode ${number}`),
					workTitle: work.title,
				});
			}
		}
	}
	return items;
};

const compareEpisodes = (left: AiringEpisode, right: AiringEpisode): number => {
	const byTitle = left.workTitle.localeCompare(right.workTitle);
	if (byTitle !== 0) {
		return byTitle;
	}
	if (left.number !== right.number) {
		return left.number - right.number;
	}
	return left.title.localeCompare(right.title);
};

const groupAiringDays = (items: readonly AiringEpisode[]): AiringDay[] => {
	const byDate = new Map<string, AiringEpisode[]>();
	for (const item of items) {
		const list = byDate.get(item.airDate) ?? [];
		list.push(item);
		byDate.set(item.airDate, list);
	}
	return [...byDate.entries()]
		.toSorted(([left], [right]) => left.localeCompare(right))
		.map(([date, episodes]) => ({
			date,
			episodes: episodes.toSorted(compareEpisodes),
		}));
};

const airingDays = (
	works: readonly AiringWork[],
	fromDay: string,
	untilDay: string,
): AiringDay[] => groupAiringDays(collectAiring(works, fromDay, untilDay));

export { addUtcDays, airingDays, FILM_LABEL, isoDay, WINDOW_DAYS };
export type { AiringDay, AiringEpisode, AiringSegment, AiringWork };
