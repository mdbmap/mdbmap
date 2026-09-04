import type { Segment } from "@/engine";
import type { CatalogueLink } from "@/orpc/schema";

type CatalogueService = CatalogueLink["service"];

const catalogueServices = [
	"anidb",
	"mal",
	"anilist",
	"tmdb",
	"imdb",
] as const satisfies readonly CatalogueService[];

const displayNames: Record<CatalogueService, string> = {
	anidb: "AniDB",
	anilist: "AniList",
	imdb: "IMDb",
	mal: "MAL",
	tmdb: "TMDB",
};

const tmdbPath = (kind: Segment["kind"]): "movie" | "tv" =>
	kind === "atomic" ? "movie" : "tv";

const hrefFor = (
	service: CatalogueService,
	id: string,
	kind: Segment["kind"],
): string => {
	switch (service) {
		case "anidb": {
			return `https://anidb.net/anime/${id}`;
		}
		case "anilist": {
			return `https://anilist.co/anime/${id}`;
		}
		case "imdb": {
			return `https://www.imdb.com/title/${id}/`;
		}
		case "mal": {
			return `https://myanimelist.net/anime/${id}`;
		}
		case "tmdb": {
			return `https://www.themoviedb.org/${tmdbPath(kind)}/${id}`;
		}
	}
};

const partLabelAt = (
	index: number,
	labels: readonly (string | undefined)[],
): string => labels[index] ?? `Part ${index + 1}`;

interface SeenMember {
	href: string;
	id: string;
	partLabel: string;
}

const membersForService = (
	service: CatalogueService,
	segments: readonly Segment[],
	labels: readonly (string | undefined)[],
): SeenMember[] => {
	const seen = new Map<string, SeenMember>();
	for (const [index, segment] of segments.entries()) {
		const id = segment.members[service];
		if (id === undefined) {
			continue;
		}
		const key = service === "tmdb" ? `${tmdbPath(segment.kind)}:${id}` : id;
		if (seen.has(key)) {
			continue;
		}
		seen.set(key, {
			href: hrefFor(service, id, segment.kind),
			id,
			partLabel: partLabelAt(index, labels),
		});
	}
	return [...seen.values()];
};

const labelledLink = (
	service: CatalogueService,
	member: SeenMember,
	multi: boolean,
): CatalogueLink => ({
	href: member.href,
	id: member.id,
	label: multi
		? `${displayNames[service]} · ${member.partLabel}`
		: displayNames[service],
	service,
});

const linksForService = (
	service: CatalogueService,
	segments: readonly Segment[],
	labels: readonly (string | undefined)[],
): CatalogueLink[] => {
	const members = membersForService(service, segments, labels);
	const multi = members.length > 1;
	return members.map((member) => labelledLink(service, member, multi));
};

const catalogueLinks = (
	segments: readonly Segment[],
	labels: readonly (string | undefined)[] = [],
): CatalogueLink[] =>
	catalogueServices.flatMap((service) =>
		linksForService(service, segments, labels),
	);

export { catalogueLinks };
