import type { Video } from "stremio-types";

import { parseId, profileOrder } from "@/engine/identity.ts";
import type { MappingResponse, Mappings } from "@/engine/serializer.ts";

const ATOMIC_EPISODE = 0;
const ATOMIC_SEASON = 0;

const firstImdbId = (mappings: Mappings): string | undefined => {
	const link = mappings.imdb;
	if (link === undefined || link.status !== "matched") {
		return undefined;
	}
	return link.counterparts[0]?.id;
};

const imdbBoundaryId = (raw: string): string | undefined => {
	for (const profile of profileOrder) {
		const parsed = parseId(profile, raw);
		if (parsed.ok && parsed.identity.title.service === "imdb") {
			return raw;
		}
	}
	return undefined;
};

const imdbVideoId = (mappings: Mappings, input: string): string | undefined =>
	firstImdbId(mappings) ?? imdbBoundaryId(input);

const titleIdOf = (imdbId: string): string => {
	const parsed = parseId("series", imdbId);
	return parsed.ok ? parsed.identity.title.id : imdbId;
};

const locatorOf = (imdbId: string): { episode: number; season: number } => {
	const parsed = parseId("series", imdbId);
	if (parsed.ok && parsed.identity.kind === "instalment") {
		return parsed.identity.locator;
	}
	return { episode: ATOMIC_EPISODE, season: ATOMIC_SEASON };
};

const videoOf = (imdbId: string): Video => {
	const { episode, season } = locatorOf(imdbId);
	const isAtomic = season === ATOMIC_SEASON && episode === ATOMIC_EPISODE;
	return {
		episode,
		id: imdbId,
		season,
		title: isAtomic ? imdbId : `S${String(season)}E${String(episode)}`,
	};
};

const videosFromMapping = (response: MappingResponse): Video[] => {
	const seen = new Set<string>();
	const videos: Video[] = [];
	const push = (imdbId: string | undefined) => {
		if (imdbId === undefined || seen.has(imdbId)) {
			return;
		}
		seen.add(imdbId);
		videos.push(videoOf(imdbId));
	};
	if (response.instalments !== undefined && response.instalments.length > 0) {
		for (const instalment of response.instalments) {
			push(imdbVideoId(instalment.mappings, instalment.input));
		}
		return videos;
	}
	push(imdbVideoId(response.mappings, response.input));
	return videos;
};

const imdbTitleIdFromMapping = (
	response: MappingResponse,
): string | undefined => {
	const fromTitle = imdbVideoId(response.mappings, response.input);
	if (fromTitle !== undefined) {
		return titleIdOf(fromTitle);
	}
	const [video] = videosFromMapping(response);
	return video === undefined ? undefined : titleIdOf(video.id);
};

export { firstImdbId, imdbTitleIdFromMapping, videosFromMapping };
