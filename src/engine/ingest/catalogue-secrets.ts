import { z } from "zod";

const optionalSecret = z
	.string()
	.optional()
	.transform((value) =>
		value === undefined || value.trim() === "" ? undefined : value,
	);

const catalogueSecretsSchema = z.object({
	ANIDB_CLIENT: optionalSecret,
	ANIDB_CLIENT_VER: optionalSecret,
	SIMKL_API_KEY: optionalSecret,
	TMDB_API_KEY: optionalSecret,
	TVDB_API_KEY: optionalSecret,
});

const catalogueSecretKeys = [
	"ANIDB_CLIENT",
	"ANIDB_CLIENT_VER",
	"SIMKL_API_KEY",
	"TMDB_API_KEY",
	"TVDB_API_KEY",
] as const;

type CatalogueSecretKey = (typeof catalogueSecretKeys)[number];

type CatalogueSecrets = Partial<Record<CatalogueSecretKey, string>>;

type CatalogueSecretsSource = Partial<
	Record<CatalogueSecretKey, string | undefined>
>;

const readCatalogueSecretsSource = (source: object): CatalogueSecretsSource => {
	const out: CatalogueSecretsSource = {};
	for (const key of catalogueSecretKeys) {
		if (!Object.hasOwn(source, key)) {
			continue;
		}
		const value: unknown = Reflect.get(source, key);
		if (typeof value === "string") {
			out[key] = value;
		}
	}
	return out;
};

const parseCatalogueSecrets = (
	source: CatalogueSecretsSource,
): CatalogueSecrets => {
	const parsed = catalogueSecretsSchema.parse(source);
	const secrets: CatalogueSecrets = {};
	for (const key of catalogueSecretKeys) {
		const value = parsed[key];
		if (value !== undefined) {
			secrets[key] = value;
		}
	}
	return secrets;
};

export {
	catalogueSecretKeys,
	catalogueSecretsSchema,
	parseCatalogueSecrets,
	readCatalogueSecretsSource,
};
export type { CatalogueSecretKey, CatalogueSecrets, CatalogueSecretsSource };
