import { ContentTypes, ExtraTypes, ResourceTypes } from "stremio-types";
import type { Manifest } from "stremio-types";

const CATALOG_IDS = {
	anime: "mdbmap.anime",
	movie: "mdbmap.movie",
	series: "mdbmap.series",
} as const;

const ID_PREFIXES = [
	"tt",
	"tmdb:",
	"kitsu:",
	"mal:",
	"anilist:",
	"tvdb:",
] as const;

const searchExtra = {
	isRequired: true,
	name: ExtraTypes.SEARCH,
} as const;

const addonManifest = {
	catalogs: [
		{
			extra: [searchExtra],
			id: CATALOG_IDS.movie,
			name: "mdbmap movies",
			type: ContentTypes.MOVIE,
		},
		{
			extra: [searchExtra],
			id: CATALOG_IDS.series,
			name: "mdbmap series",
			type: ContentTypes.SERIES,
		},
		{
			extra: [searchExtra],
			id: CATALOG_IDS.anime,
			name: "mdbmap anime",
			type: ContentTypes.SERIES,
		},
	],
	description:
		"Maps catalogue titles to IMDb video IDs for Stremio stream addons.",
	id: "community.mdbmap",
	idPrefixes: [...ID_PREFIXES],
	name: "mdbmap",
	resources: [
		ResourceTypes.CATALOG,
		{
			idPrefixes: [...ID_PREFIXES],
			name: ResourceTypes.META,
			types: [ContentTypes.MOVIE, ContentTypes.SERIES],
		},
	],
	types: [ContentTypes.MOVIE, ContentTypes.SERIES],
	version: "1.0.0",
} as const satisfies Manifest;

export { addonManifest, CATALOG_IDS, ID_PREFIXES };
