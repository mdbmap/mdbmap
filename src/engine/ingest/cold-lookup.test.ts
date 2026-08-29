import { afterEach, describe, expect, it, vi } from "vitest";

import {
	serviceCoverages,
	serviceTitles,
	titleAssertions,
	titleGroups,
} from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import type { SimklClient } from "@/engine/discovery";
import type { DiscoveryClients } from "@/engine/discovery/structural.ts";
import { runMapping } from "@/engine/gateway";
import type { ColdLookup, ColdResult } from "@/engine/gateway";
import type { BuildDispatcher } from "@/engine/overflow";

import { createLiveColdLookup } from "./cold-lookup.ts";
import type { IngestEnv } from "./env.ts";
import { buildStructuralDiscoveryClients } from "./structural-discovery.ts";

const simklEntry = (
	type: "anime" | "movie" | "show",
	exists = true,
): SimklClient => ({
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
					type,
				}
			: undefined,
});

const movieSimkl = (exists = true): SimklClient => simklEntry("movie", exists);

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

const failingMovieEstimate = (): DiscoveryClients => ({
	...movieDiscovery(),
	find: {
		find: () => {
			throw new Error("discovery unavailable");
		},
	},
});

const ingestEnv = async (
	discovery: DiscoveryClients,
	probeExists = true,
	dispatcher?: BuildDispatcher,
): Promise<IngestEnv> => ({
	catalogue: {
		simkl: movieSimkl(probeExists),
		verification: {},
	},
	db: await freshDb(),
	dispatcher,
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

const liveLookup = (ingest: IngestEnv): ColdLookup =>
	createLiveColdLookup({ resolveIngest: () => ingest });

const runObservedLiveLookup = async (ingest: IngestEnv) => {
	const liveColdLookup = liveLookup(ingest);
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
			coldLookup: liveLookup(ingest),
			db: ingest.db,
		});

		expect(response.status).toBe(200);
		await expect(response.json()).resolves.toMatchObject({
			input: "tmdb:603",
			mappings: {
				imdb: {
					counterparts: [
						{
							assertionPath: [{ confidence: "high", source: "t1-structure" }],
							id: "tt0133093",
						},
					],
					status: "matched",
				},
			},
		});
		expect(await ingest.db.select().from(titleAssertions).all()).toMatchObject([
			{ confidence: "high", source: "t1-structure" },
		]);
	});
});

describe("warm movie lookup", () => {
	it("does not resolve ingest dependencies for a warm movie mapping", async () => {
		const ingest = await ingestEnv(movieDiscovery());
		await runMapping("movie", "tmdb:603", {
			coldLookup: liveLookup(ingest),
			db: ingest.db,
		});
		const resolveIngest = vi.fn(() => ingest);

		const response = await runMapping("movie", "tmdb:603", {
			coldLookup: createLiveColdLookup({ resolveIngest }),
			db: ingest.db,
		});

		expect(response.status).toBe(200);
		expect(resolveIngest).not.toHaveBeenCalled();
	});
});

describe("pending movie cold lookup", () => {
	it("completes coverage when discovery finds no counterpart", async () => {
		const ingest = await ingestEnv(movieDiscovery(0));
		const response = await runMapping("movie", "tmdb:603", {
			coldLookup: liveLookup(ingest),
			db: ingest.db,
		});

		expect(response.status).toBe(200);
		expect(await ingest.db.select().from(serviceCoverages).get()).toMatchObject(
			{ state: "complete" },
		);
		expect(await ingest.db.select().from(titleAssertions).all()).toHaveLength(
			0,
		);
	});
});

describe("live movie over-budget dispatch", () => {
	it("returns pending with the seeded coverage row when work exceeds budget", async () => {
		const dispatched: Parameters<BuildDispatcher["ensure"]>[] = [];
		const dispatcher: BuildDispatcher = {
			ensure: async (...args) => {
				await Promise.resolve();
				dispatched.push(args);
			},
		};
		const ingest = await ingestEnv(movieDiscovery(51), true, dispatcher);
		await occupyCoverageIds(ingest);
		const { coldResultKind, response } = await runObservedLiveLookup(ingest);

		expect(response.status).toBe(202);
		expect(coldResultKind).toBe("updated");
		expect(dispatched).toHaveLength(1);
		const coverages = await ingest.db.select().from(serviceCoverages).all();
		const coverage = coverages.find((row) => row.state === "pending");
		expect(coverage?.state).toBe("pending");
		expect(dispatched[0]?.[1]).toMatchObject({
			identity: {
				kind: "title",
				title: { id: "603", service: "tmdb" },
			},
			profile: "movie",
			work: {
				baselineRevision: 1,
				targetService: "imdb",
			},
		});
		await expect(response.json()).resolves.toMatchObject({
			statusUrl: `/api/engine/status/pending:${coverage?.id.toString(36)}`,
		});
	});
});

describe("live movie overflow idempotency", () => {
	it("derives one deterministic workflow id for concurrent over-budget begins", async () => {
		const instanceIds: string[] = [];
		const ingest = await ingestEnv(movieDiscovery(51), true, {
			ensure: async (instanceId) => {
				await Promise.resolve();
				instanceIds.push(instanceId);
			},
		});
		const coldLookup = createLiveColdLookup({ resolveIngest: () => ingest });
		const identity = {
			kind: "title",
			title: { id: "603", namespace: "movie", service: "tmdb" },
		} as const;

		const [first, second] = await Promise.all([
			coldLookup.begin(identity, "movie"),
			coldLookup.begin(identity, "movie"),
		]);

		expect([first, second]).toEqual([{ kind: "updated" }, { kind: "updated" }]);
		expect(instanceIds).toHaveLength(2);
		expect(new Set(instanceIds).size).toBe(1);
	});
});

describe("live movie cold lookup misses", () => {
	it("returns unknown without writing when the catalogue rejects the id", async () => {
		const ingest = await ingestEnv(movieDiscovery(), false);
		const response = await runMapping("movie", "tmdb:999", {
			coldLookup: liveLookup(ingest),
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

describe("live episodic cold lookup", () => {
	it("starts the series ingest pipeline for a TMDB cold miss", async () => {
		const base = await ingestEnv(movieDiscovery());
		const ingest = {
			...base,
			catalogue: { ...base.catalogue, simkl: simklEntry("show") },
			structuralDiscovery: undefined,
		};

		const response = await runMapping("series", "tmdb:603", {
			coldLookup: createLiveColdLookup({ resolveIngest: () => ingest }),
			db: ingest.db,
		});

		expect(response.status).toBe(202);
		await expect(
			ingest.db.select().from(serviceCoverages).all(),
		).resolves.toEqual([
			expect.objectContaining({
				state: "pending",
				targetService: "imdb",
			}),
		]);
	});

	it("starts anime fan-out for an AniList cold miss", async () => {
		const base = await ingestEnv(movieDiscovery());
		const ingest = { ...base, structuralDiscovery: undefined };

		const response = await runMapping("anime", "anilist:1", {
			coldLookup: createLiveColdLookup({ resolveIngest: () => ingest }),
			db: ingest.db,
		});

		expect(response.status).toBe(202);
		const coverages = await ingest.db.select().from(serviceCoverages).all();
		expect(coverages.map((row) => row.targetService)).toEqual(["mal"]);
	});
});

describe("live movie cold lookup failures", () => {
	it("terminates pending coverage when estimating ingest work fails", async () => {
		const ingest = await ingestEnv(failingMovieEstimate());

		await expect(
			runMapping("movie", "tmdb:603", {
				coldLookup: createLiveColdLookup({
					resolveIngest: () => ingest,
				}),
				db: ingest.db,
			}),
		).rejects.toThrow("discovery unavailable");
		expect(await ingest.db.select().from(serviceCoverages).get()).toMatchObject(
			{ state: "conflict" },
		);

		const retry = await runMapping("movie", "tmdb:603", { db: ingest.db });
		expect(retry.status).toBe(409);
	});

	it("terminates pending coverage when overflow dispatch fails", async () => {
		const ingest = await ingestEnv(movieDiscovery(51), true, {
			ensure: () => {
				throw new Error("dispatcher unavailable");
			},
		});

		await expect(
			runMapping("movie", "tmdb:603", {
				coldLookup: createLiveColdLookup({
					resolveIngest: () => ingest,
				}),
				db: ingest.db,
			}),
		).rejects.toThrow("dispatcher unavailable");
		expect(await ingest.db.select().from(serviceCoverages).get()).toMatchObject(
			{ state: "conflict" },
		);

		const retry = await runMapping("movie", "tmdb:603", { db: ingest.db });
		expect(retry.status).toBe(409);
	});

	it("does not convert an unexpected publish failure to pending", async () => {
		const ingest = await ingestEnv(failingMovieDiscovery());

		await expect(
			runMapping("movie", "tmdb:603", {
				coldLookup: liveLookup(ingest),
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
			coldLookup: liveLookup(ingest),
			db: ingest.db,
		});

		expect(response.status).toBe(409);
		expect(await ingest.db.select().from(serviceCoverages).get()).toMatchObject(
			{ state: "conflict" },
		);
	});
});
