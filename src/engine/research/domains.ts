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

// Prefer the operator's API host so catalogue tool results carry a real
// official endpoint URL rather than a placeholder provenance string.
const catalogueRequestUrl = (service: string, serviceId: string): string => {
	const hosts = officialOperatorHosts[service.toLowerCase()] ?? [];
	const host =
		hosts.find((candidate) => candidate.startsWith("api")) ?? hosts[0];
	if (host === undefined) {
		throw new Error(`research domains: no official host for ${service}`);
	}
	return `https://${host}/title/${encodeURIComponent(serviceId)}`;
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

export { catalogueRequestUrl, isOfficialOperatorUrl, officialOperatorHosts };
