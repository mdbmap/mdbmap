import { describe, expect, it } from "vitest";

import { parseCatalogueSecrets } from "./catalogue-secrets.ts";

describe("parseCatalogueSecrets", () => {
	it("accepts Worker env field names for every catalogue key", () => {
		const secrets = parseCatalogueSecrets({
			ANIDB_CLIENT: "mdbmap",
			ANIDB_CLIENT_VER: "1",
			SIMKL_API_KEY: "simkl-key",
			TMDB_API_KEY: "tmdb-key",
			TVDB_API_KEY: "tvdb-key",
		});

		expect(secrets).toStrictEqual({
			ANIDB_CLIENT: "mdbmap",
			ANIDB_CLIENT_VER: "1",
			SIMKL_API_KEY: "simkl-key",
			TMDB_API_KEY: "tmdb-key",
			TVDB_API_KEY: "tvdb-key",
		});
	});

	it("treats missing and empty values as absent optional secrets", () => {
		expect(parseCatalogueSecrets({})).toStrictEqual({});
		expect(
			parseCatalogueSecrets({
				SIMKL_API_KEY: "",
				TMDB_API_KEY: "   ",
			}),
		).toStrictEqual({});
	});
});
