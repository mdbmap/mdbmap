import { describe, expect, it, vi } from "vitest";

import { buildStructuralDiscoveryClients } from "./structural-discovery.ts";

const urlOf = (input: RequestInfo | URL): string => {
	if (typeof input === "string") {
		return input;
	}
	return input instanceof URL ? input.href : input.url;
};

describe("buildStructuralDiscoveryClients", () => {
	it("returns SIMKL first_aired from describe", async () => {
		const clients = buildStructuralDiscoveryClients({
			simkl: {
				fetchEntry: async () => {},
				findByExternalId: () => ({
					externalIds: { mal: "42" },
					firstAirDate: "2022-04-09",
					id: "1",
					relations: [],
					title: "Fixture",
					type: "anime" as const,
				}),
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
			simkl: {
				fetchEntry: async () => {},
				findByExternalId: async () => {},
			},
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

	it("skips unsupported enumeration services without throwing", async () => {
		const clients = buildStructuralDiscoveryClients({
			simkl: {
				fetchEntry: async () => {},
				findByExternalId: async () => {},
			},
		});

		const enumerated = await clients.instalments.enumerate({
			service: "tmdb",
			serviceId: "123",
		});

		expect(enumerated.stream.instalments).toHaveLength(0);
	});
});
