import { createRouterClient } from "@orpc/server";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { continuitySegments } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import { createEngine } from "@/engine";
import { parseContinuityKey, workPathId } from "@/engine/continuity/keys";
import { persistWatchOrder } from "@/engine/continuity/orders";
import {
	seedCrossGroupContinuity,
	seedSpyXFamily,
	seedTmdbContinuity,
	seedTmdbGroup,
} from "@/engine/test-continuity";
import type { ORPCContext, SessionUser } from "@/orpc/context";
import { defaultProviders } from "@/orpc/providers";
import type { Providers, WorkMetadata } from "@/orpc/providers";
import type { Similar, WorkBlock } from "@/orpc/schema";
import { WorkGetInput } from "@/orpc/schema";

import { router } from "./index.ts";

const locatorsOf = (parts: WorkBlock[]) =>
	parts.flatMap((part) =>
		part.kind === "film"
			? [part.instalmentLocator]
			: part.episodes.map((episode) => episode.instalmentLocator),
	);

const partKeyByLocator = (parts: WorkBlock[]) =>
	Object.fromEntries(
		parts.flatMap((part) => {
			if (part.kind === "film") {
				return [[part.instalmentLocator, part.rateableUnit.key]];
			}
			return part.episodes.map((episode) => [
				episode.instalmentLocator,
				part.rateableUnit.key,
			]);
		}),
	);

const firstLocator = (part: WorkBlock) =>
	part.kind === "film"
		? part.instalmentLocator
		: part.episodes[0]?.instalmentLocator;

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

const workTestProviders: Providers = {
	...defaultProviders,
	metadata: {
		...defaultProviders.metadata,
		tmdb: {
			fetchWork: async () => {
				const metadata = await Promise.resolve(metadataFor([]));
				return metadata;
			},
		},
	},
};

const clientFor = (
	db: Awaited<ReturnType<typeof freshDb>>,
	user?: SessionUser,
	providers = workTestProviders,
) =>
	createRouterClient(router, {
		context: {
			db,
			providers,
			resolveSession: () => user,
		} satisfies ORPCContext,
	});

const similar = (continuityId: string, title: string): Similar => ({
	continuityId,
	coverRef: undefined,
	title,
});

describe("work.get missing continuity", () => {
	it("rejects an unknown continuity as NOT_FOUND", async () => {
		const db = await freshDb();
		await expect(
			clientFor(db).work.get({ continuityId: "continuity:999999" }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
	});
});

describe("work.get similar links", () => {
	it("resolves seeded TMDB and AniDB refs while preserving unresolved refs", async () => {
		const db = await freshDb();
		const source = await seedTmdbContinuity(db, "tv", "10");
		const target = await seedCrossGroupContinuity(db);
		const providers: Providers = {
			...defaultProviders,
			metadata: {
				...defaultProviders.metadata,
				tmdb: {
					fetchWork: async () => {
						const metadata = await Promise.resolve(
							metadataFor([
								similar("tmdb:tv:3001", "Seeded series"),
								similar("tmdb:movie:3002", "Seeded film"),
								similar("anidb:1002", "Seeded anime"),
								similar("tmdb:tv:999", "Missing work"),
								similar("imdb:tt999", "Unsupported work"),
							]),
						);
						return metadata;
					},
				},
			},
		};

		const view = await clientFor(db, undefined, providers).work.get({
			continuityId: source.continuityId,
		});

		const workHref = `/work/${workPathId(target.continuityId)}`;
		expect(view.ifYouLiked).toEqual([
			similar(target.continuityId, "Seeded series"),
			similar("tmdb:tv:999", "Missing work"),
			similar("imdb:tt999", "Unsupported work"),
		]);
		expect(
			view.ifYouLiked
				.slice(0, 1)
				.map((item) => `/work/${workPathId(item.continuityId)}`),
		).toEqual([workHref]);
		for (const item of view.ifYouLiked.slice(1)) {
			expect(workPathId(item.continuityId)).toBeUndefined();
		}
	});

	it("materialises continuity when the matched group has titles but none yet", async () => {
		const db = await freshDb();
		const source = await seedTmdbContinuity(db, "tv", "10");
		const target = await seedTmdbGroup(db, "tv", "4001");
		const providers: Providers = {
			...defaultProviders,
			metadata: {
				...defaultProviders.metadata,
				tmdb: {
					fetchWork: async () => {
						const metadata = await Promise.resolve(
							metadataFor([similar(target.providerRef, "Unmaterialised work")]),
						);
						return metadata;
					},
				},
			},
		};

		const view = await clientFor(db, undefined, providers).work.get({
			continuityId: source.continuityId,
		});

		expect(view.ifYouLiked).toHaveLength(1);
		expect(view.ifYouLiked[0]?.title).toBe("Unmaterialised work");
		expect(view.ifYouLiked[0]?.continuityId).toMatch(/^continuity:\d+$/u);
		expect(workPathId(view.ifYouLiked[0]?.continuityId ?? "")).toBeDefined();
	});
});

describe("work.get presentation orders", () => {
	it("rejects matching-order slugs at the input boundary", () => {
		expect(() =>
			WorkGetInput.parse({
				continuityId: "continuity:1",
				order: "t1-structure",
			}),
		).toThrow();
		expect(
			WorkGetInput.parse({ continuityId: "continuity:1", order: "watch" }),
		).toEqual({
			continuityId: "continuity:1",
			locale: "en",
			order: "watch",
		});
	});

	it("returns the same blocks in watch vs release sequence", async () => {
		const db = await freshDb();
		const { continuityId } = await seedSpyXFamily(db);
		const client = clientFor(db);
		const resolved = await createEngine(db).resolveContinuity(continuityId);
		const parsed = parseContinuityKey(resolved.continuityId);
		if (parsed === undefined) {
			throw new Error("expected a canonical continuity");
		}
		const segments = await db
			.select()
			.from(continuitySegments)
			.where(eq(continuitySegments.continuityId, parsed))
			.orderBy(asc(continuitySegments.releaseOrdinal))
			.all();
		await persistWatchOrder(db, {
			continuityId: parsed,
			segmentIds: segments.toReversed().map((segment) => segment.id),
		});

		const release = await client.work.get({
			continuityId,
			order: "release",
		});
		const watch = await client.work.get({
			continuityId,
			order: "watch",
		});
		const fallback = await client.work.get({ continuityId });

		expect(release.parts.length).toBeGreaterThan(1);
		expect(release.header.genres).toEqual([]);
		expect(release.header.runtimeMinutes).toBe(24);
		expect(release.header.productionStatus).toBeUndefined();
		expect(watch.parts.map((part) => firstLocator(part))).toEqual(
			[...release.parts].toReversed().map((part) => firstLocator(part)),
		);
		expect(locatorsOf(watch.parts).toSorted()).toEqual(
			locatorsOf(release.parts).toSorted(),
		);
		expect(partKeyByLocator(watch.parts)).toEqual(
			partKeyByLocator(release.parts),
		);
		expect(watch.parts.map((part) => firstLocator(part))).toEqual(
			fallback.parts.map((part) => firstLocator(part)),
		);
		expect(release.parts.every((part) => part.kind === "part")).toBe(true);
		expect(JSON.stringify(watch)).not.toMatch(/matching.?order/iu);
	});
});

describe("work.get catalogues", () => {
	it("surfaces unique Spy × Family counterpart ids and the TMDB tv URL", async () => {
		const db = await freshDb();
		const { continuityId } = await seedSpyXFamily(db);
		const view = await clientFor(db).work.get({ continuityId });
		const idsOf = (service: string) =>
			view.catalogues
				.filter((link) => link.service === service)
				.map((link) => link.id);

		expect(idsOf("anidb")).toEqual(["16947", "17061", "17784"]);
		expect(idsOf("mal")).toEqual(["50265", "50602", "53887"]);
		expect(idsOf("anilist")).toEqual(["140960", "142838", "158927"]);
		expect(idsOf("tmdb")).toEqual(["120089"]);
		expect(view.catalogues.find((link) => link.service === "tmdb")?.href).toBe(
			"https://www.themoviedb.org/tv/120089",
		);
		expect(view.catalogues.map((link) => link.service)).toEqual([
			"anidb",
			"anidb",
			"anidb",
			"mal",
			"mal",
			"mal",
			"anilist",
			"anilist",
			"anilist",
			"tmdb",
		]);
	});
});

describe("work.get film blocks", () => {
	it("returns a film block on the film title locator, not a series SxEy", async () => {
		const db = await freshDb();
		const { continuityId } = await seedCrossGroupContinuity(db);
		const client = clientFor(db);
		const view = await client.work.get({ continuityId });
		const [series, film] = view.parts;

		expect(view.parts.map((part) => part.kind)).toEqual(["part", "film"]);
		expect(series?.kind).not.toBe("film");
		expect(series?.rateableUnit).toEqual({
			key: `part:${view.continuityId}:0`,
			kind: "part",
		});
		expect(film).toEqual(
			expect.objectContaining({
				episodes: [],
				instalmentLocator: "anidb:1002#1",
				kind: "film",
				rateableUnit: { key: "anidb:1002#1", kind: "movie" },
				watched: false,
			}),
		);
		expect(film?.kind === "film" ? film.instalmentLocator : "").not.toMatch(
			/s\d+e\d+/iu,
		);
		expect(locatorsOf(view.parts)).toEqual([
			"anidb:1001#1",
			"anidb:1001#2",
			"anidb:1002#1",
		]);
	});

	it("keeps episodic part keys stable when watch order puts the film first", async () => {
		const db = await freshDb();
		const { continuityId } = await seedCrossGroupContinuity(db);
		const client = clientFor(db);
		const resolved = await createEngine(db).resolveContinuity(continuityId);
		const parsed = parseContinuityKey(resolved.continuityId);
		if (parsed === undefined) {
			throw new Error("expected a canonical continuity");
		}
		const segments = await db
			.select()
			.from(continuitySegments)
			.where(eq(continuitySegments.continuityId, parsed))
			.orderBy(asc(continuitySegments.releaseOrdinal))
			.all();
		await persistWatchOrder(db, {
			continuityId: parsed,
			segmentIds: segments.toReversed().map((segment) => segment.id),
		});

		const release = await client.work.get({
			continuityId,
			order: "release",
		});
		const watch = await client.work.get({
			continuityId,
			order: "watch",
		});
		const partKey = `part:${release.continuityId}:0`;

		expect(release.parts.map((part) => part.kind)).toEqual(["part", "film"]);
		expect(watch.parts.map((part) => part.kind)).toEqual(["film", "part"]);
		expect(partKeyByLocator(watch.parts)).toEqual(
			partKeyByLocator(release.parts),
		);
		expect(
			release.parts.find((part) => part.kind !== "film")?.rateableUnit.key,
		).toBe(partKey);
		expect(
			watch.parts.find((part) => part.kind !== "film")?.rateableUnit.key,
		).toBe(partKey);
		expect(locatorsOf(watch.parts).toSorted()).toEqual(
			locatorsOf(release.parts).toSorted(),
		);
	});
});

describe("work.refreshMetadata", () => {
	it("admits one refresh per continuity per 24 hours", async () => {
		const db = await freshDb();
		const source = await seedTmdbContinuity(db, "tv", "10");
		let fetches = 0;
		const providers: Providers = {
			...defaultProviders,
			metadata: {
				...defaultProviders.metadata,
				tmdb: {
					fetchWork: async () => {
						fetches += 1;
						const metadata = await Promise.resolve({
							...metadataFor([]),
							lastUpdatedAt: "2026-09-05T12:00:00.000Z",
						});
						return metadata;
					},
				},
			},
		};
		const client = clientFor(db, undefined, providers);
		const first = await client.work.refreshMetadata({
			continuityId: source.continuityId,
		});
		expect(first.lastUpdatedAt).toBe("2026-09-05T12:00:00.000Z");
		expect(fetches).toBe(1);
		await expect(
			client.work.refreshMetadata({ continuityId: source.continuityId }),
		).rejects.toMatchObject({ code: "TOO_MANY_REQUESTS" });
		expect(fetches).toBe(1);
		const view = await client.work.get({ continuityId: source.continuityId });
		expect(view.header.userRefreshAvailableAt).toBeDefined();
	});
});
