import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { freshDb } from "@/db/test-helpers";
import { seedTmdbContinuity } from "@/engine/test-continuity";
import type { ORPCContext, SessionUser } from "@/orpc/context";
import { defaultProviders } from "@/orpc/providers";
import type { CatalogueSearchHit, Providers } from "@/orpc/providers";

import { router } from "./index.ts";

type TestDb = Awaited<ReturnType<typeof freshDb>>;

const clientFor = (db: TestDb, providers: Providers, user?: SessionUser) =>
	createRouterClient(router, {
		context: {
			db,
			providers,
			resolveSession: () => user,
		} satisfies ORPCContext,
	});

const hit = (
	partial: Omit<CatalogueSearchHit, "coverRef" | "year"> &
		Partial<Pick<CatalogueSearchHit, "coverRef" | "year">>,
): CatalogueSearchHit => ({
	coverRef: undefined,
	year: undefined,
	...partial,
});

const providersWithSearch = (
	hits: readonly CatalogueSearchHit[],
): Providers => ({
	...defaultProviders,
	catalogueSearch: {
		search: async () => {
			await Promise.resolve();
			return hits;
		},
	},
});

describe("search.query blank input", () => {
	it("returns an empty list without calling catalogue search", async () => {
		const db = await freshDb();
		let called = false;
		const providers: Providers = {
			...defaultProviders,
			catalogueSearch: {
				search: async () => {
					called = true;
					await Promise.resolve();
					return [
						hit({
							catalogue: {
								id: "1",
								namespace: "movie",
								service: "tmdb",
							},
							mediaKind: "film",
							title: "Should not appear",
						}),
					];
				},
			},
		};

		const client = clientFor(db, providers);
		await expect(client.search.query({ query: "   " })).resolves.toEqual([]);
		await expect(client.search.query({ query: "" })).resolves.toEqual([]);
		expect(called).toBe(false);
	});
});

describe("search.query unmapped hit", () => {
	it("keeps continuityId undefined when D1 has no mapping", async () => {
		const db = await freshDb();
		const providers = providersWithSearch([
			hit({
				catalogue: {
					id: "603",
					namespace: "movie",
					service: "tmdb",
				},
				coverRef: "tmdb:/matrix.jpg",
				mediaKind: "film",
				title: "The Matrix",
				year: 1999,
			}),
		]);

		const results = await clientFor(db, providers).search.query({
			query: "matrix",
		});

		expect(results).toEqual([
			{
				catalogue: {
					id: "603",
					namespace: "movie",
					service: "tmdb",
				},
				continuityId: undefined,
				coverRef: "tmdb:/matrix.jpg",
				mediaKind: "film",
				title: "The Matrix",
				year: 1999,
			},
		]);
	});
});

describe("search.query mapped hit", () => {
	it("attaches continuityId when the catalogue identity is in D1", async () => {
		const db = await freshDb();
		const { continuityId } = await seedTmdbContinuity(db, "tv", "1396");
		const providers = providersWithSearch([
			hit({
				catalogue: { id: "1396", namespace: "tv", service: "tmdb" },
				coverRef: "tmdb:/bb.jpg",
				mediaKind: "tv",
				title: "Breaking Bad",
				year: 2008,
			}),
		]);

		const results = await clientFor(db, providers).search.query({
			mediaKind: "tv",
			query: "breaking",
		});

		expect(results).toEqual([
			{
				catalogue: { id: "1396", namespace: "tv", service: "tmdb" },
				continuityId,
				coverRef: "tmdb:/bb.jpg",
				mediaKind: "tv",
				title: "Breaking Bad",
				year: 2008,
			},
		]);
	});
});
