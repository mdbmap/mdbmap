// Official operator hosts the research scrape tool may hit (ADR-0004). Community
// wikis and fan sites are never admitted — they also never count toward the
// corroboration gate.
const officialOperatorHosts: Readonly<Record<string, readonly string[]>> = {
	anidb: ["anidb.net", "api.anidb.net"],
	anilist: ["anilist.co", "graphql.anilist.co"],
	imdb: ["imdb.com", "www.imdb.com"],
	kitsu: ["kitsu.app", "kitsu.io"],
	mal: ["myanimelist.net", "api.myanimelist.net"],
	tmdb: ["themoviedb.org", "www.themoviedb.org", "api.themoviedb.org"],
	tvdb: ["thetvdb.com", "www.thetvdb.com", "api4.thetvdb.com"],
};

const hostOf = (url: string): string | undefined => {
	try {
		return new URL(url).hostname.toLowerCase();
	} catch {
		return undefined;
	}
};

// Exact host match only — `wiki.anidb.net` must not ride on `anidb.net`.
// True when `url` belongs to an official operator domain for the named service
// (or any mapping service when `operator` is omitted).
const isOfficialOperatorUrl = (
	url: string,
	operator?: string,
): boolean => {
	const hostname = hostOf(url);
	if (hostname === undefined) {
		return false;
	}
	const hosts =
		operator === undefined
			? Object.values(officialOperatorHosts).flat()
			: (officialOperatorHosts[operator.toLowerCase()] ?? []);
	return hosts.some((allowed) => hostname === allowed);
};

export { isOfficialOperatorUrl, officialOperatorHosts };
