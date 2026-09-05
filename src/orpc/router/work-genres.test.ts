import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { freshDb } from "@/db/test-helpers";
import { seedSpyXFamily } from "@/engine/test-continuity";
import type { ORPCContext, SessionUser } from "@/orpc/context";
import { defaultProviders } from "@/orpc/providers";
import type { Providers, WorkMetadata } from "@/orpc/providers";
import type { Similar } from "@/orpc/schema";

import { router } from "./index.ts";

const metadataFor = (ifYouLiked: readonly Similar[]): WorkMetadata => ({
	backdropRef: undefined,
	cast: [],
	coverRef: undefined,
	genres: [],
	ifYouLiked,
	nativeTitle: undefined,
	productionStatus: undefined,
	runtimeMinutes: undefined,
	segments: [],
	span: "",
	staff: [],
	studios: [],
	synopsis: "",
	title: "Test work",
});

const clientFor = (
	db: Awaited<ReturnType<typeof freshDb>>,
	providers: Providers,
	user?: SessionUser,
) =>
	createRouterClient(router, {
		context: {
			db,
			providers,
			resolveSession: () => user,
		} satisfies ORPCContext,
	});

describe("work.get anime genres", () => {
	it("takes header genres from tmdb and keeps anidb runtime", async () => {
		const db = await freshDb();
		const { continuityId } = await seedSpyXFamily(db);
		const providers: Providers = {
			...defaultProviders,
			metadata: {
				...defaultProviders.metadata,
				tmdb: {
					fetchWork: async () => {
						const metadata = await Promise.resolve({
							...metadataFor([]),
							genres: ["Comedy", "Action"],
						});
						return metadata;
					},
				},
			},
		};
		const view = await clientFor(db, providers).work.get({ continuityId });
		expect(view.header.genres).toEqual(["Comedy", "Action"]);
		expect(view.header.runtimeMinutes).toBe(24);
	});

	it("keeps anidb genres when they are present even if tmdb fails", async () => {
		const db = await freshDb();
		const { continuityId } = await seedSpyXFamily(db);
		const providers: Providers = {
			...defaultProviders,
			metadata: {
				anidb: {
					fetchWork: async () => {
						const metadata = await Promise.resolve({
							...metadataFor([]),
							genres: ["Comedy"],
							runtimeMinutes: 24,
						});
						return metadata;
					},
				},
				tmdb: {
					fetchWork: () => {
						throw new Error("tmdb down");
					},
				},
			},
		};
		const view = await clientFor(db, providers).work.get({ continuityId });
		expect(view.header.genres).toEqual(["Comedy"]);
	});

	it("drops header genres when tmdb fails", async () => {
		const db = await freshDb();
		const { continuityId } = await seedSpyXFamily(db);
		const providers: Providers = {
			...defaultProviders,
			metadata: {
				...defaultProviders.metadata,
				tmdb: {
					fetchWork: () => {
						throw new Error("tmdb down");
					},
				},
			},
		};
		const view = await clientFor(db, providers).work.get({ continuityId });
		expect(view.header.genres).toEqual([]);
		expect(view.header.runtimeMinutes).toBe(24);
	});
});
