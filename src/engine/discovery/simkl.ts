import type { Promisable } from "type-fest";
import { z } from "zod";

// SIMKL is the primary discovery broker (ADR-0002). This is the client seam the
// broker and walk sit behind: a real implementation talks to SIMKL, tests mock
// the interface. A missing record answers `undefined`; a failed request throws,
// and the broker turns either into a fall-through to direct discovery.

const simklServices = ["anidb", "anilist", "imdb", "mal", "tmdb", "tvdb"] as const;
type SimklService = (typeof simklServices)[number];

// The catalogues SIMKL can align natively vs. the ones it only carries as
// candidate cross-references (ADR-0002: TV↔TVDB, film↔TMDB, anime↔AniDB verify
// cheaply; everything else stays a candidate the target must confirm).
type SimklExternalIds = Partial<Record<SimklService, string>>;

// Only prequel/sequel build the continuity; every other relation is ignored so
// side stories, spin-offs, recaps and alternatives never shift the mainline.
const mainlineRelations = ["prequel", "sequel"] as const;
type MainlineRelation = (typeof mainlineRelations)[number];

const auxiliaryRelations = [
	"alternative",
	"character",
	"other",
	"recap",
	"side_story",
	"spin_off",
	"summary",
] as const;

const knownRelationKinds = [...mainlineRelations, ...auxiliaryRelations] as const;
type SimklRelationKind = (typeof knownRelationKinds)[number];

interface SimklRelation {
	kind: SimklRelationKind;
	toId: string;
}

interface SimklEntry {
	externalIds: SimklExternalIds;
	id: string;
	relations: readonly SimklRelation[];
	title: string;
	// SIMKL carries films and shows too; only anime-shaped records are walked.
	type: "anime" | "movie" | "show";
}

interface SimklClient {
	fetchEntry: (simklId: string) => Promisable<SimklEntry | undefined>;
	findByExternalId: (
		service: SimklService,
		serviceId: string,
	) => Promisable<SimklEntry | undefined>;
}

const DEFAULT_BASE_URL = "https://api.simkl.com";

interface SimklClientDeps {
	apiKey: string;
	baseUrl?: string;
	fetchFn?: typeof fetch;
}

const numericId = z.union([z.string(), z.number()]);

const idsSchema = z.object({
	anidb: numericId.optional(),
	anilist: numericId.optional(),
	imdb: z.string().optional(),
	mal: numericId.optional(),
	simkl: numericId,
	tmdb: numericId.optional(),
	tvdb: numericId.optional(),
});

const relationSchema = z.object({
	ids: z.object({ simkl: numericId }),
	relation_type: z.string(),
});

const entrySchema = z.object({
	ids: idsSchema,
	relations: z.array(relationSchema).optional(),
	title: z.string().optional(),
	type: z.string().optional(),
});

const searchSchema = z.array(entrySchema);

type RawEntry = z.infer<typeof entrySchema>;

const asId = (value: string | number | undefined): string | undefined =>
	value === undefined ? undefined : String(value);

const externalIdsOf = (ids: RawEntry["ids"]): SimklExternalIds => {
	const externalIds: SimklExternalIds = {};
	for (const service of simklServices) {
		const value = asId(ids[service]);
		if (value !== undefined) {
			externalIds[service] = value;
		}
	}
	return externalIds;
};

const relationKindOf = (raw: string): SimklRelationKind => {
	const normalised = raw.toLowerCase().replaceAll(" ", "_");
	return knownRelationKinds.find((kind) => kind === normalised) ?? "other";
};

const shapeOf = (type: string | undefined): SimklEntry["type"] => {
	if (type === "movie") {
		return "movie";
	}
	return type === "anime" ? "anime" : "show";
};

const normalise = (raw: RawEntry): SimklEntry => ({
	externalIds: externalIdsOf(raw.ids),
	id: String(raw.ids.simkl),
	relations: (raw.relations ?? []).map((relation) => ({
		kind: relationKindOf(relation.relation_type),
		toId: String(relation.ids.simkl),
	})),
	title: raw.title ?? "",
	type: shapeOf(raw.type),
});

const createSimklClient = (deps: SimklClientDeps): SimklClient => {
	const { apiKey, baseUrl = DEFAULT_BASE_URL, fetchFn = fetch } = deps;

	const getJson = async <Schema extends z.ZodType>(
		path: string,
		schema: Schema,
	): Promise<z.infer<Schema>> => {
		const separator = path.includes("?") ? "&" : "?";
		const response = await fetchFn(`${baseUrl}${path}${separator}client_id=${apiKey}`);
		if (!response.ok) {
			throw new Error(`simkl: ${response.status} for ${path}`);
		}
		const json: unknown = await response.json();
		return schema.parse(json);
	};

	return {
		fetchEntry: async (simklId) => {
			const raw = await getJson(`/anime/${simklId}?extended=full`, entrySchema);
			return normalise(raw);
		},
		findByExternalId: async (service, serviceId) => {
			const found = await getJson(`/search/id?${service}=${serviceId}`, searchSchema);
			const [raw] = found;
			return raw === undefined ? undefined : normalise(raw);
		},
	};
};

export { createSimklClient, simklServices };
export type {
	MainlineRelation,
	SimklClient,
	SimklClientDeps,
	SimklEntry,
	SimklExternalIds,
	SimklRelation,
	SimklRelationKind,
	SimklService,
};
