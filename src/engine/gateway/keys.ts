import type {
	Identity,
	Locator,
	Service,
	TitleIdentity,
} from "@/engine/identity.ts";

// Boundary identities carry a namespace out-of-band (ADR-0001); the flat graph
// key folds TMDB's namespace into the stored id so movie 603 and tv 603 never
// collide under the (service, service_id) unique index.
interface GraphMember {
	readonly service: Service;
	readonly serviceId: string;
}

const identityServices = [
	"anilist",
	"imdb",
	"kitsu",
	"mal",
	"tmdb",
	"tvdb",
] as const satisfies readonly Service[];

const isIdentityService = (service: string): service is Service =>
	identityServices.some((candidate) => candidate === service);

const tmdbNamespaces = ["movie", "tv"] as const;

const toGraphMember = (title: TitleIdentity): GraphMember =>
	title.service === "tmdb"
		? { service: "tmdb", serviceId: `${title.namespace}:${title.id}` }
		: { service: title.service, serviceId: title.id };

// Reverse of toGraphMember. Returns undefined for a stored member the identity
// model cannot express (an unknown service, or a malformed TMDB namespace key),
// so one unrepresentable spoke is skipped rather than aborting the response.
const toTitleIdentity = (member: GraphMember): TitleIdentity | undefined => {
	if (!isIdentityService(member.service)) {
		return undefined;
	}
	if (member.service !== "tmdb") {
		return { id: member.serviceId, service: member.service };
	}
	const [namespace, id] = member.serviceId.split(":");
	if (namespace === undefined || id === undefined) {
		return undefined;
	}
	const match = tmdbNamespaces.find((candidate) => candidate === namespace);
	return match === undefined
		? undefined
		: { id, namespace: match, service: "tmdb" };
};

// Canonical position locator shared by every service in the graph. Flat
// catalogues always sit at season 1 (ADR-0001), so one form round-trips both.
const toGraphLocator = (locator: Locator): string =>
	`s${locator.season}e${locator.episode}`;

const graphLocatorPattern = /^s(?<season>\d+)e(?<episode>\d+)$/u;

const toLocator = (stored: string): Locator | undefined => {
	const groups = graphLocatorPattern.exec(stored)?.groups;
	const season = groups?.["season"];
	const episode = groups?.["episode"];
	if (season === undefined || episode === undefined) {
		return undefined;
	}
	return { episode: Number(episode), season: Number(season) };
};

const memberTitle = (member: GraphMember): Identity | undefined => {
	const title = toTitleIdentity(member);
	return title === undefined ? undefined : { kind: "title", title };
};

const memberInstalment = (
	member: GraphMember,
	stored: string,
): Identity | undefined => {
	const title = toTitleIdentity(member);
	const locator = toLocator(stored);
	return title === undefined || locator === undefined
		? undefined
		: { kind: "instalment", locator, title };
};

export {
	isIdentityService,
	memberInstalment,
	memberTitle,
	toGraphLocator,
	toGraphMember,
	toLocator,
};
export type { GraphMember };
