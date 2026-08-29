/// <reference types="@cloudflare/vitest-pool-workers/types" />

import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

import { freshDb } from "@/db/test-helpers";
import { discover } from "@/engine/discovery";
import { randomMasterKey } from "@/lib/provider-config/test-support.ts";

import { parseCatalogueSecrets } from "./catalogue-secrets.ts";
import { buildCatalogueClients } from "./clients.ts";
import { createIngestEnvFromSource } from "./env.ts";

describe("createIngestEnvFromSource", () => {
	it("builds without catalogue keys and leaves SIMKL unconfigured for broker fallthrough", async () => {
		const ingest = createIngestEnvFromSource(env, {}, { db: await freshDb() });

		expect(ingest.afterPublish).toBeUndefined();
		expect(ingest.catalogue.simkl).toBeUndefined();
		expect(ingest.catalogue.verification).toStrictEqual({});
		expect(ingest.structuralDiscovery).toBeDefined();

		const outcome = await discover(
			{ cursor: { id: "1", service: "mal" }, target: "anilist" },
			{},
		);
		expect(outcome).toMatchObject({
			kind: "fallthrough",
			reason: "unconfigured",
		});
	});

	it("builds SIMKL and verification clients when secrets are present", () => {
		const secrets = parseCatalogueSecrets({
			ANIDB_CLIENT: "mdbmap",
			ANIDB_CLIENT_VER: "1",
			SIMKL_API_KEY: "simkl",
			TMDB_API_KEY: "tmdb",
			TVDB_API_KEY: "tvdb",
		});
		const clients = buildCatalogueClients({ secrets });

		expect(clients.simkl).toBeDefined();
		expect(clients.verification.tmdb).toBeDefined();
		expect(clients.verification.tvdb).toBeDefined();
		expect(clients.verification.anidb).toBeDefined();
	});

	it("wires afterPublish research when a provider master key is configured", async () => {
		const masterKey = randomMasterKey();
		const ingest = createIngestEnvFromSource(
			{ ...env, PROVIDER_CONFIG_MASTER_KEY: masterKey },
			{},
			{ db: await freshDb() },
		);

		expect(ingest.afterPublish?.research?.deps.masterKey).toBe(masterKey);
		expect(ingest.afterPublish?.research?.deps.timing).toBeDefined();
		expect(ingest.afterPublish?.clients).toStrictEqual({});
	});
});
