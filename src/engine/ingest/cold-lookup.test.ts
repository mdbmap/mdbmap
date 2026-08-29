import { afterEach, describe, expect, it, vi } from "vitest";

import {
	serviceCoverages,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import type { SimklClient } from "@/engine/discovery";
import type { DiscoveryClients } from "@/engine/discovery/structural.ts";
import { runMapping } from "@/engine/gateway";
import type { ColdLookup, ColdResult } from "@/engine/gateway";

import { createLiveColdLookup } from "./cold-lookup.ts";
import type { IngestEnv } from "./env.ts";
import { buildStructuralDiscoveryClients } from "./structural-discovery.ts";

const movieSimkl = (exists = true): SimklClient => ({
	fetchEntry: async (): Promise<undefined> => {
		await Promise.resolve();
		return;
	},
	findByExternalId: () =>
		exists
			? {
					externalIds: { imdb: "tt0133093", tmdb: "603" },
					firstAirDate: "1999-03-31",
					id: "1",
					relations: [],
					title: "The Matrix",
					type: "movie",
				}
			: undefined,
});

const movieDiscovery = (candidateCount = 1): DiscoveryClients => ({
	externalIds: {
		describe: (title) => ({
			externalIds:
				title.service === "imdb"
					? [{ service: "tmdb", serviceId: "movie:603" }]
					: [{ service: "imdb", serviceId: "tt0133093" }],
			firstAirDate: "1999-03-31",
		}),
	},
	find: {
		find: () =>
			Array.from({ length: candidateCount }, (_unused, position) => ({
				service: "imdb",
				serviceId: position === 0 ? "tt0133093" : `tt${position}`,
			})),
	},
	instalments: {
		enumerate: () => {
			throw new Error("live movie lookup must use atomic enumeration");
		},
	},
});

const failingMovieDiscovery = (): DiscoveryClients => ({
	...movieDiscovery(),
	externalIds: {
		describe: () => {
			throw new Error("catalogue unavailable");
		},
	},
});

const ingestEnv = async (
	discovery: DiscoveryClients,
	probeExists = true,
): Promise<IngestEnv> => ({
	catalogue: {
		simkl: movieSimkl(probeExists),
		verification: {},
	},
	db: await freshDb(),
	dispatcher: undefined,
	structuralDiscovery: discovery,
});

const occupyCoverageIds = async (ingest: IngestEnv): Promise<void> => {
	await ingest.db
		.insert(serviceCoverages)
		.values(
			Array.from(
				{ length: 9 },
				(_unused, position) =>
					({
						baselineContinuity: "group:999",
						revision: position + 1,
						state: "complete",
						targetService: "imdb",
					}) satisfies typeof serviceCoverages.$inferInsert,
			),
		)
		.run();
};

const runObservedLiveLookup = async (ingest: IngestEnv) => {
	const liveColdLookup = createLiveColdLookup({ ingest });
	let coldResultKind: ColdResult["kind"] | undefined;
	const observedColdLookup: ColdLookup = {
		begin: async (identity, profile) => {
			const result = await liveColdLookup.begin(identity, profile);
			coldResultKind = result.kind;
			return result;
		},
	};
	const response = await runMapping("movie", "tmdb:603", {
		coldLookup: observedColdLookup,
		db: ingest.db,
	});
	return { coldResultKind, response };
};

afterEach(() => {
	vi.restoreAllMocks();
});

describe("movie catalogue discovery", () => {
	it("normalizes namespaced TMDB ids across production discovery", async () => {
		const discovery = buildStructuralDiscoveryClients({
			simkl: movieSimkl(),
		});
		const candidates = await discovery.find.find({
			service: "tmdb",
			serviceId: "movie:603",
		});
		const [imdb] = candidates;

		expect(imdb).toEqual({ service: "imdb", serviceId: "tt0133093" });
		const descriptor =
			imdb === undefined
				? undefined
				: await discovery.externalIds.describe(imdb);
		expect(descriptor?.externalIds).toContainEqual({
			service: "tmdb",
			serviceId: "movie:603",
		});
	});
});

describe("live movie cold lookup", () => {
	it("publishes a cold movie mapping and returns it in the same request", async () => {
		const ingest = await ingestEnv(movieDiscovery());
		const response = await runMapping("movie", "tmdb:603", {
			coldLookup: createLiveColdLookup({ ingest }),
			db: ingest.db,
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			input: "tmdb:603",
			mappings: {
				imdb: {
					counterparts: [{ id: "tt0133093" }],
					status: "matched",
				},
			},
		});
	});

	it("returns pending with the seeded coverage row when work exceeds budget", async () => {
		const ingest = await ingestEnv(movieDiscovery(51));
		await occupyCoverageIds(ingest);
		const { coldResultKind, response } = await runObservedLiveLookup(ingest);

		expect(response.status).toBe(202);
		expect(coldResultKind).toBe("updated");
		const coverages = await ingest.db.select().from(serviceCoverages).all();
		const coverage = coverages.find((row) => row.state === "pending");
		expect(coverage?.state).toBe("pending");
		await expect(response.json()).resolves.toMatchObject({
			statusUrl: `/api/engine/status/pending:${coverage?.id.toString(36)}`,
		});
	});

	it("returns unknown without writing when the catalogue rejects the id", async () => {
		const ingest = await ingestEnv(movieDiscovery(), false);
		const response = await runMapping("movie", "tmdb:999", {
			coldLookup: createLiveColdLookup({ ingest }),
			db: ingest.db,
		});

		expect(response.status).toBe(404);
		expect(await ingest.db.select().from(titleGroups).all()).toHaveLength(0);
		expect(await ingest.db.select().from(serviceTitles).all()).toHaveLength(0);
		expect(await ingest.db.select().from(serviceCoverages).all()).toHaveLength(
			0,
		);
	});
});

describe("live movie cold lookup failures", () => {
	it("does not convert an unexpected publish failure to pending", async () => {
		const ingest = await ingestEnv(failingMovieDiscovery());

		await expect(
			runMapping("movie", "tmdb:603", {
				coldLookup: createLiveColdLookup({ ingest }),
				db: ingest.db,
			}),
		).rejects.toThrow("catalogue unavailable");
		expect(await ingest.db.select().from(serviceCoverages).get()).toMatchObject(
			{ state: "conflict" },
		);

		const retry = await runMapping("movie", "tmdb:603", { db: ingest.db });
		expect(retry.status).toBe(409);
	});

	it("terminates pending coverage when inline publish refuses", async () => {
		const publishModule = await import("./publish.ts");
		vi.spyOn(publishModule, "runAtomicTargetPublish").mockResolvedValueOnce({
			kind: "refused",
			reason: "unpublishable",
		});
		const ingest = await ingestEnv(movieDiscovery());

		const response = await runMapping("movie", "tmdb:603", {
			coldLookup: createLiveColdLookup({ ingest }),
			db: ingest.db,
		});

		expect(response.status).toBe(409);
		expect(await ingest.db.select().from(serviceCoverages).get()).toMatchObject(
			{ state: "conflict" },
		);
	});
});
