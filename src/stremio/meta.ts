import { ContentTypes } from "stremio-types";
import type { ContentType, MetaItem, Video } from "stremio-types";

import type { MappingOutcome } from "@/engine/gateway";
import { parseId } from "@/engine/identity.ts";
import type { Profile } from "@/engine/identity.ts";
import type { MappingResponse } from "@/engine/serializer.ts";
import type { WorkMetadata } from "@/orpc/providers";

import { backgroundUrl, posterUrl } from "./images.ts";
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

const nonempty = (value: string | undefined): string | undefined => {
	if (value === undefined) {
		return undefined;
	}
	const trimmed = value.trim();
	return trimmed === "" ? undefined : trimmed;
};

const isAtomicVideo = (video: Video): boolean =>
	video.season === 0 && video.episode === 0;

const episodeFor = (segments: WorkMetadata["segments"], video: Video) => {
	if (video.season < 1) {
		return;
	}
	return segments[video.season - 1]?.episodes.find(
		(entry) => entry.number === video.episode,
	);
};

const overlayVideo = (video: Video, display: WorkMetadata): Video => {
	const episode = episodeFor(display.segments, video);
	const title =
		nonempty(episode?.title) ??
		(isAtomicVideo(video) ? nonempty(display.title) : undefined) ??
		video.title;
	const released = nonempty(episode?.airDate);
	return {
		...video,
		...(title === undefined ? {} : { title }),
		...(released === undefined ? {} : { released }),
	};
};

const runtimeOf = (minutes: number | undefined): string | undefined => {
	if (minutes === undefined || minutes <= 0) {
		return undefined;
	}
	return `${String(minutes)} min`;
};

const applyDisplay = (meta: MetaItem, display: WorkMetadata): MetaItem => {
	const name = nonempty(display.title) ?? meta.name;
	const description = nonempty(display.synopsis);
	const poster = posterUrl(display.coverRef);
	const background = backgroundUrl(display.backdropRef);
	const genres = display.genres.filter((genre) => genre.trim() !== "");
	const releaseInfo = nonempty(display.span);
	const runtime = runtimeOf(display.runtimeMinutes);
	const videos = (meta.videos ?? []).map((video) =>
		overlayVideo(video, display),
	);
	return {
		...meta,
		...(name === undefined ? {} : { name }),
		videos,
		...(description === undefined ? {} : { description }),
		...(poster === undefined ? {} : { poster }),
		...(background === undefined ? {} : { background }),
		...(genres.length === 0 ? {} : { genres }),
		...(releaseInfo === undefined ? {} : { releaseInfo }),
		...(runtime === undefined ? {} : { runtime }),
	};
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

export { applyDisplay, metaFromOutcome, profileFor };
