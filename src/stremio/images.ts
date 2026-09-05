const TMDB_IMAGE_ORIGIN = "https://image.tmdb.org/t/p";
const TMDB_REF_PREFIX = "tmdb:";

type TmdbSize = "w500" | "w1280";

const absoluteUrl = (ref: string): string | undefined => {
	if (ref.startsWith("https://") || ref.startsWith("http://")) {
		return ref;
	}
	return undefined;
};

const tmdbUrl = (ref: string, size: TmdbSize): string | undefined => {
	if (!ref.startsWith(TMDB_REF_PREFIX)) {
		return undefined;
	}
	const path = ref.slice(TMDB_REF_PREFIX.length);
	if (path === "") {
		return undefined;
	}
	const normalized = path.startsWith("/") ? path : `/${path}`;
	return `${TMDB_IMAGE_ORIGIN}/${size}${normalized}`;
};

const imageUrl = (
	ref: string | undefined,
	size: TmdbSize,
): string | undefined => {
	if (ref === undefined || ref === "") {
		return undefined;
	}
	return absoluteUrl(ref) ?? tmdbUrl(ref, size);
};

const posterUrl = (ref: string | undefined): string | undefined =>
	imageUrl(ref, "w500");

const backgroundUrl = (ref: string | undefined): string | undefined =>
	imageUrl(ref, "w1280");

export { backgroundUrl, posterUrl };
