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

// Official API origin only — never invent path segments the client did not hit.
const catalogueRequestUrl = (service: string): string => {
	const hosts = officialOperatorHosts[service.toLowerCase()] ?? [];
	const host =
		hosts.find((candidate) => candidate.startsWith("api")) ?? hosts[0];
	if (host === undefined) {
		throw new Error(`research domains: no official host for ${service}`);
	}
	return `https://${host}`;
};

const isOfficialOperatorUrl = (url: string, operator?: string): boolean => {
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
