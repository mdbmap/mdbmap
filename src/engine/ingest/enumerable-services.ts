const instalmentEnumerableAnimeServices = ["anilist", "mal"] as const;

const instalmentEnumerableServices = new Set<string>(
	instalmentEnumerableAnimeServices,
);

export { instalmentEnumerableAnimeServices, instalmentEnumerableServices };
