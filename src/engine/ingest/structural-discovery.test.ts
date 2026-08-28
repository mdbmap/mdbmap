import { describe, expect, it, vi } from "vitest";

import type { SimklClient, SimklEntry } from "@/engine/discovery/simkl.ts";

import { buildStructuralDiscoveryClients } from "./structural-discovery.ts";

const urlOf = (input: RequestInfo | URL): string => {
	if (typeof input === "string") {
		return input;
	}
	return input instanceof URL ? input.href : input.url;
};

const emptyEntries = new Map<string, SimklEntry>();

const emptySimkl: SimklClient = {
	fetchEntry: async (simklId) => {
		await Promise.resolve();
		return emptyEntries.get(simklId);
	},
	findByExternalId: async (service, serviceId) => {
		await Promise.resolve();
		return emptyEntries.get(`${service}:${serviceId}`);
	},
};

describe("buildStructuralDiscoveryClients", () => {
	it("returns SIMKL first_aired from describe", async () => {
		const clients = buildStructuralDiscoveryClients({
			simkl: {
				fetchEntry: emptySimkl.fetchEntry,
				findByExternalId: async () => {
					await Promise.resolve();
					return {
						externalIds: { mal: "42" },
						firstAirDate: "2022-04-09",
						id: "1",
						relations: [],
						title: "Fixture",
						type: "anime" as const,
					};
				},
			},
		});

		const described = await clients.externalIds.describe({
			service: "mal",
			serviceId: "42",
		});

		expect(described.firstAirDate).toBe("2022-04-09");
	});

	it("paginates Jikan episode pages before marking MAL complete", async () => {
		const fetchFn = vi.fn(
			async (input: RequestInfo | URL): Promise<Response> => {
				await Promise.resolve();
				const url = urlOf(input);
				if (url.includes("episodes?page=1")) {
					return Response.json({
						data: Array.from({ length: 100 }, (_unused, index) => ({
							episode: index + 1,
							title: `Ep ${index + 1}`,
						})),
						pagination: { has_next_page: true },
					});
				}
				if (url.includes("episodes?page=2")) {
					return Response.json({
						data: [{ episode: 101, title: "Ep 101" }],
						pagination: { has_next_page: false },
					});
				}
				if (!url.includes("/episodes")) {
					return Response.json({
						data: { airing: false, episodes: 101, status: "Finished Airing" },
					});
				}
				throw new Error(`unexpected fetch: ${url}`);
			},
		);

		const clients = buildStructuralDiscoveryClients({
			fetchFn,
			simkl: emptySimkl,
		});

		const enumerated = await clients.instalments.enumerate({
			service: "mal",
			serviceId: "99",
		});

		expect(enumerated.stream.instalments).toHaveLength(101);
		expect(enumerated.stream.boundary).toBe("complete");
		expect(
			fetchFn.mock.calls.some((call) => urlOf(call[0]).includes("page=2")),
		).toBe(true);
	});

	it("fetches anilist page 1 once during enumeration", async () => {
		const fetchFn = vi.fn(
			async (input: RequestInfo | URL): Promise<Response> => {
				await Promise.resolve();
				const url = urlOf(input);
				if (!url.includes("graphql.anilist.co")) {
					throw new Error(`unexpected fetch: ${url}`);
				}
				return Response.json({
					data: {
						Media: {
							episodes: 2,
							episodesList: {
								episodes: [
									{
										airingAt: 1_649_990_400,
										episode: 1,
										title: { romaji: "One" },
									},
									{
										airingAt: 1_650_595_200,
										episode: 2,
										title: { romaji: "Two" },
									},
								],
								pageInfo: { hasNextPage: false },
							},
							startDate: { day: 9, month: 4, year: 2022 },
							status: "FINISHED",
							title: { romaji: "Fixture" },
						},
					},
				});
			},
		);

		const clients = buildStructuralDiscoveryClients({
			fetchFn,
			simkl: emptySimkl,
		});

		await clients.instalments.enumerate({
			service: "anilist",
			serviceId: "140960",
		});

		const graphqlCalls = fetchFn.mock.calls.filter((call) =>
			urlOf(call[0]).includes("graphql.anilist.co"),
		);
		expect(graphqlCalls).toHaveLength(1);
	});
	it("throws when AniList episode payload is malformed", async () => {
		const fetchFn = vi.fn(
			async (input: RequestInfo | URL): Promise<Response> => {
				await Promise.resolve();
				const url = urlOf(input);
				if (url.includes("graphql.anilist.co")) {
					return Response.json({ data: { Media: { episodes: "bad" } } });
				}
				throw new Error(`unexpected fetch: ${url}`);
			},
		);

		const clients = buildStructuralDiscoveryClients({
			fetchFn,
			simkl: emptySimkl,
		});

		await expect(
			clients.instalments.enumerate({ service: "anilist", serviceId: "88" }),
		).rejects.toThrow(/malformed media payload/u);
	});
	it("throws when Jikan episode payload is malformed", async () => {
		const fetchFn = vi.fn(
			async (input: RequestInfo | URL): Promise<Response> => {
				await Promise.resolve();
				const url = urlOf(input);
				if (url.includes("/episodes")) {
					return Response.json({ not: "episodes" });
				}
				return Response.json({
					data: { airing: false, episodes: 12, status: "Finished Airing" },
				});
			},
		);

		const clients = buildStructuralDiscoveryClients({
			fetchFn,
			simkl: emptySimkl,
		});

		await expect(
			clients.instalments.enumerate({ service: "mal", serviceId: "77" }),
		).rejects.toThrow(/malformed episodes payload/u);
	});
	it("skips unsupported enumeration services without throwing", async () => {
		const clients = buildStructuralDiscoveryClients({ simkl: emptySimkl });

		const enumerated = await clients.instalments.enumerate({
			service: "tmdb",
			serviceId: "123",
		});

		expect(enumerated.stream.instalments).toHaveLength(0);
		expect(enumerated.stream.boundary).toBe("truncated");
	});
	it("downgrades complete boundary when mal episodes fall short of meta count", async () => {
		const fetchFn = vi.fn(
			async (input: RequestInfo | URL): Promise<Response> => {
				await Promise.resolve();
				const url = urlOf(input);
				if (url.includes("/episodes")) {
					return Response.json({
						data: [{ episode: 1, title: "One" }],
						pagination: { has_next_page: false },
					});
				}
				return Response.json({
					data: { airing: false, episodes: 12, status: "Finished Airing" },
				});
			},
		);
		const clients = buildStructuralDiscoveryClients({
			fetchFn,
			simkl: emptySimkl,
		});
		const enumerated = await clients.instalments.enumerate({
			service: "mal",
			serviceId: "77",
		});
		expect(enumerated.stream.boundary).toBe("truncated");
	});
});
