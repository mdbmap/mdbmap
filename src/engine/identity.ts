// Canonical boundary id <-> internal identity (ADR-0001). Pure string work: no
// DB, no IO. Every Stremio-compatibility quirk lives here so the internal model
// never sees a boundary string.

const serviceOrder = [
	"anilist",
	"imdb",
	"kitsu",
	"mal",
	"tmdb",
	"tvdb",
] as const;

type Service = (typeof serviceOrder)[number];

// Namespace only branches for TMDB, whose movie and TV ids share one numeric
// space; a route supplies the discriminator its id cannot carry.
type TmdbNamespace = "movie" | "tv";

type TitleIdentity =
	| {
			readonly id: string;
			readonly namespace: TmdbNamespace;
			readonly service: "tmdb";
	  }
	| { readonly id: string; readonly service: "anilist" }
	| { readonly id: string; readonly service: "imdb" }
	| { readonly id: string; readonly service: "kitsu" }
	| { readonly id: string; readonly service: "mal" }
	| { readonly id: string; readonly service: "tvdb" };

interface Locator {
	readonly episode: number;
	readonly season: number;
}

// An atomic lookup names the title itself; an episodic lookup adds a positional
// locator inside it.
type Identity =
	| {
			readonly kind: "instalment";
			readonly locator: Locator;
			readonly title: TitleIdentity;
	  }
	| { readonly kind: "title"; readonly title: TitleIdentity };

type Profile = "anime" | "movie" | "series";

type ParseErrorReason =
	| "extra-qualifier-segment"
	| "malformed-locator"
	| "malformed-native-id"
	| "positional-not-allowed"
	| "season-not-one"
	| "service-not-in-profile"
	| "tmdb-not-in-anime"
	| "unrecognised-service";

interface ParseError {
	readonly expected: string;
	readonly reason: ParseErrorReason;
}

type ParseResult =
	| { readonly error: ParseError; readonly ok: false }
	| { readonly identity: Identity; readonly ok: true };

type SeasonMode = "explicit" | "flat";

interface BoundarySpec {
	readonly idPattern: RegExp;
	// "glued" carries its prefix in the id (IMDb tt...); "keyword" is a "name:" segment.
	readonly prefix: "glued" | "keyword";
	// "flat" applies the flat-or-season-one rule; "explicit" always names season and episode.
	readonly seasonMode: SeasonMode;
}

const boundary = {
	anilist: { idPattern: /^\d+$/u, prefix: "keyword", seasonMode: "flat" },
	imdb: { idPattern: /^tt\d+$/u, prefix: "glued", seasonMode: "explicit" },
	kitsu: { idPattern: /^\d+$/u, prefix: "keyword", seasonMode: "flat" },
	mal: { idPattern: /^\d+$/u, prefix: "keyword", seasonMode: "flat" },
	tmdb: { idPattern: /^\d+$/u, prefix: "keyword", seasonMode: "explicit" },
	tvdb: { idPattern: /^\d+$/u, prefix: "keyword", seasonMode: "explicit" },
} satisfies Record<Service, BoundarySpec>;

interface ProfileSpec {
	// Non-TMDB services this route admits. TMDB admission is governed by tmdbNamespace.
	readonly admits: readonly Service[];
	readonly atomicOnly: boolean;
	readonly tmdbNamespace: TmdbNamespace | undefined;
}

const profiles = {
	anime: {
		admits: ["anilist", "imdb", "kitsu", "mal", "tvdb"],
		atomicOnly: false,
		tmdbNamespace: undefined,
	},
	movie: { admits: ["imdb"], atomicOnly: true, tmdbNamespace: "movie" },
	series: { admits: ["imdb"], atomicOnly: false, tmdbNamespace: "tv" },
} satisfies Record<Profile, ProfileSpec>;

interface Failure {
	readonly error: ParseError;
	readonly ok: false;
}

const failure = (reason: ParseErrorReason, expected: string): Failure => ({
	error: { expected, reason },
	ok: false,
});

const toCount = (value: string | undefined): number | undefined =>
	value !== undefined && /^\d+$/u.test(value) ? Number(value) : undefined;

type Identified =
	| Failure
	| {
			readonly id: string;
			readonly locatorSegments: readonly string[];
			readonly ok: true;
			readonly service: Service;
	  };

const identify = (raw: string): Identified => {
	const [head, ...rest] = raw.split(":");
	if (head === undefined || head === "") {
		return failure(
			"unrecognised-service",
			"a service-prefixed id, e.g. tmdb:603 or tt0133093",
		);
	}
	if (boundary.imdb.idPattern.test(head)) {
		return { id: head, locatorSegments: rest, ok: true, service: "imdb" };
	}
	const service = serviceOrder.find((candidate) => candidate === head);
	if (service === undefined || boundary[service].prefix !== "keyword") {
		return failure(
			"unrecognised-service",
			"a known prefix (tmdb, tvdb, kitsu, mal, anilist) or a tt IMDb id",
		);
	}
	const [nativeId, ...locatorSegments] = rest;
	if (nativeId === undefined || !boundary[service].idPattern.test(nativeId)) {
		return failure(
			"malformed-native-id",
			`a numeric ${service} id, e.g. ${service}:12345`,
		);
	}
	return { id: nativeId, locatorSegments, ok: true, service };
};

type Located =
	| Failure
	| { readonly locator: Locator | undefined; readonly ok: true };

const flatLocator = (segments: readonly string[]): Located => {
	if (segments.length > 2) {
		return failure(
			"extra-qualifier-segment",
			"at most an episode, optionally prefixed by season 1",
		);
	}
	if (segments.length === 1) {
		const episode = toCount(segments[0]);
		return episode === undefined
			? failure("malformed-locator", "a numeric episode")
			: { locator: { episode, season: 1 }, ok: true };
	}
	const season = toCount(segments[0]);
	const episode = toCount(segments[1]);
	if (season === undefined || episode === undefined) {
		return failure("malformed-locator", "a numeric season and episode");
	}
	if (season !== 1) {
		return failure(
			"season-not-one",
			"season 1; flat catalogues have no other season",
		);
	}
	return { locator: { episode, season: 1 }, ok: true };
};

const explicitLocator = (segments: readonly string[]): Located => {
	if (segments.length > 2) {
		return failure(
			"extra-qualifier-segment",
			"exactly a season and an episode",
		);
	}
	const season = toCount(segments[0]);
	const episode = toCount(segments[1]);
	return season === undefined || episode === undefined
		? failure("malformed-locator", "a season and an episode, e.g. :2:5")
		: { locator: { episode, season }, ok: true };
};

const interpretLocator = (
	service: Service,
	segments: readonly string[],
	atomicOnly: boolean,
): Located => {
	if (segments.length === 0) {
		return { locator: undefined, ok: true };
	}
	if (atomicOnly) {
		return failure(
			"positional-not-allowed",
			"an atomic id with no season or episode",
		);
	}
	return boundary[service].seasonMode === "flat"
		? flatLocator(segments)
		: explicitLocator(segments);
};

type Admission = Failure | { readonly ok: true; readonly title: TitleIdentity };

const resolveTitle = (
	spec: ProfileSpec,
	service: Service,
	id: string,
): Admission => {
	if (service === "tmdb") {
		return spec.tmdbNamespace === undefined
			? failure(
					"tmdb-not-in-anime",
					"a non-TMDB anime id; TMDB resolves only under /movie or /series",
				)
			: {
					ok: true,
					title: { id, namespace: spec.tmdbNamespace, service: "tmdb" },
				};
	}
	if (!spec.admits.includes(service)) {
		const allowed =
			spec.tmdbNamespace === undefined ? spec.admits : [...spec.admits, "tmdb"];
		return failure(
			"service-not-in-profile",
			`an id for one of: ${allowed.join(", ")}`,
		);
	}
	return { ok: true, title: { id, service } };
};

const isTitleAdmitted = (profile: Profile, title: TitleIdentity): boolean => {
	const spec = profiles[profile];
	const admission = resolveTitle(spec, title.service, title.id);
	if (!admission.ok) {
		return false;
	}
	if (title.service === "tmdb") {
		return (
			admission.title.service === "tmdb" &&
			admission.title.namespace === title.namespace
		);
	}
	return true;
};

const parseId = (profile: Profile, raw: string): ParseResult => {
	const identified = identify(raw);
	if (!identified.ok) {
		return identified;
	}
	const spec = profiles[profile];
	const admission = resolveTitle(spec, identified.service, identified.id);
	if (!admission.ok) {
		return admission;
	}
	const located = interpretLocator(
		identified.service,
		identified.locatorSegments,
		spec.atomicOnly,
	);
	if (!located.ok) {
		return located;
	}
	return located.locator === undefined
		? { identity: { kind: "title", title: admission.title }, ok: true }
		: {
				identity: {
					kind: "instalment",
					locator: located.locator,
					title: admission.title,
				},
				ok: true,
			};
};

const formatTitle = (title: TitleIdentity): string =>
	title.service === "imdb" ? title.id : `${title.service}:${title.id}`;

// The Identity type cannot express "flat services carry season 1" without the
// locator and title correlating across the parse path, so formatId guards it:
// a flat-mode season other than 1 would silently reparse as season 1.
class FormatError extends Error {
	public readonly reason = "flat-season-not-one";

	public constructor(service: Service, season: number) {
		super(
			`${service} is a flat catalogue with no season ${season}; only season 1 is representable`,
		);
		this.name = "FormatError";
	}
}

const formatId = (identity: Identity): string => {
	const head = formatTitle(identity.title);
	if (identity.kind === "title") {
		return head;
	}
	const { locator, title } = identity;
	if (boundary[title.service].seasonMode === "flat") {
		if (locator.season !== 1) {
			throw new FormatError(title.service, locator.season);
		}
		return `${head}:${locator.episode}`;
	}
	return `${head}:${locator.season}:${locator.episode}`;
};

export { FormatError, formatId, isTitleAdmitted, parseId, serviceOrder };
export type {
	Identity,
	Locator,
	ParseError,
	ParseErrorReason,
	ParseResult,
	Profile,
	Service,
	TitleIdentity,
	TmdbNamespace,
};
