import { ContentTypes } from "stremio-types";
import type { ContentType, MetaItem } from "stremio-types";

import type { MappingOutcome } from "@/engine/gateway";
import { parseId } from "@/engine/identity.ts";
import type { Profile } from "@/engine/identity.ts";
import type { MappingResponse } from "@/engine/serializer.ts";

import { firstImdbId, videosFromMapping } from "./videos.ts";

const profileFor = (type: ContentType, id: string): Profile | undefined => {
	if (type === ContentTypes.MOVIE) {
		if (parseId("movie", id).ok) {
			return "movie";
		}
		if (parseId("anime", id).ok) {
			return "anime";
		}
		return undefined;
	}
	if (type === ContentTypes.SERIES || type === ContentTypes.TV) {
		if (parseId("series", id).ok) {
			return "series";
		}
		if (parseId("anime", id).ok) {
			return "anime";
		}
	}
	return undefined;
};

const metaTypeOf = (type: ContentType): ContentType =>
	type === ContentTypes.MOVIE ? ContentTypes.MOVIE : ContentTypes.SERIES;

const metaName = (response: MappingResponse, requestedId: string): string => {
	const imdbId = firstImdbId(response.mappings);
	if (imdbId === undefined) {
		return requestedId;
	}
	const parsed = parseId("series", imdbId);
	return parsed.ok ? parsed.identity.title.id : imdbId;
};

const metaFromMapping = (
	response: MappingResponse,
	type: ContentType,
	requestedId: string,
): MetaItem => {
	const videos = videosFromMapping(response);
	const [firstVideo] = videos;
	return {
		id: requestedId,
		name: metaName(response, requestedId),
		type: metaTypeOf(type),
		videos,
		...(firstVideo === undefined
			? {}
			: { behaviorHints: { defaultVideoId: firstVideo.id } }),
	};
};

const metaFromOutcome = (
	outcome: MappingOutcome,
	type: ContentType,
	requestedId: string,
): MetaItem | undefined => {
	switch (outcome.kind) {
		case "malformed":
		case "unknown": {
			return undefined;
		}
		case "conflict":
		case "ok":
		case "pending": {
			return metaFromMapping(outcome.body, type, requestedId);
		}
	}
};

export { metaFromOutcome, profileFor };
