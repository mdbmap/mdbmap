import { beforeEach, describe, expect, it } from "vitest";

import { one } from "@/db";
import { titleGroups } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";

import { buildResearchTools } from "./tools.ts";
import type { ResearchCatalogueClient } from "./tools.ts";

type TestDb = Awaited<ReturnType<typeof freshDb>>;

const seedGroup = async (db: TestDb) =>
	one(
		await db
			.insert(titleGroups)
			.values({ ladderComplete: false, source: "t1-structure" })
			.returning()
			.all(),
	);

const clientWith = (
	overrides: Partial<ResearchCatalogueClient> &
		Pick<ResearchCatalogueClient, "fetchTitle">,
): ResearchCatalogueClient => ({
	...overrides,
	fetchTitle: overrides.fetchTitle,
});

describe("research catalogue tools", () => {
	let db: TestDb;
	let groupId: number;

	beforeEach(async () => {
		db = await freshDb();
		const group = await seedGroup(db);
		groupId = group.id;
	});

	it("treats an undefined catalogue as unavailable without throwing", async () => {
		const tools = buildResearchTools({
			clients: {
				tmdb: clientWith({
					fetchTitle: async () => {
						await Promise.resolve();
						return;
					},
					requestUrl: (serviceId) =>
						`https://api.themoviedb.org/3/tv/${serviceId}`,
				}),
			},
			db,
			groupId,
		});
		await expect(tools.fetchCatalogue("tmdb", "999")).resolves.toEqual({
			kind: "api",
			operator: "tmdb",
			ref: { service: "tmdb", serviceId: "999" },
			unavailable: true,
			url: "https://api.themoviedb.org/3/tv/999",
			validated: false,
		});
	});

	it("returns unavailable for an unconfigured service without throwing", async () => {
		const tools = buildResearchTools({
			clients: {},
			db,
			groupId,
		});
		await expect(tools.fetchCatalogue("unknown", "1")).resolves.toMatchObject({
			kind: "api",
			unavailable: true,
			url: "",
			validated: false,
		});
	});

	it("prefers the client requestUrl over a fabricated catalogue path", async () => {
		const tools = buildResearchTools({
			clients: {
				tmdb: clientWith({
					fetchCatalogue: async () => {
						await Promise.resolve();
						return { instalments: [], title: "Breaking Bad" };
					},
					fetchTitle: async () => {
						await Promise.resolve();
						return {
							format: undefined,
							instalmentCount: undefined,
							releaseDate: undefined,
							title: "Breaking Bad",
						};
					},
					requestUrl: (id) => `https://api.themoviedb.org/3/tv/${id}`,
				}),
			},
			db,
			groupId,
		});
		const fetched = await tools.fetchCatalogue("tmdb", "1396");
		expect(fetched.unavailable).toBeUndefined();
		expect(fetched.url).toBe("https://api.themoviedb.org/3/tv/1396");
		expect(fetched.url.includes("/title/")).toBe(false);
	});
});
