import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import { episodeProgress, user, watchStatus } from "@/db/schema";
import { freshDb } from "@/db/test-helpers";
import type { ResolveResult } from "@/engine";
import { createEngine } from "@/engine";
import { seedSpyXFamily } from "@/engine/test-continuity";
import { isoDay } from "@/orpc/airing";
import type { ORPCContext } from "@/orpc/context";
import { instalmentsOf } from "@/orpc/instalments";
import { defaultProviders } from "@/orpc/providers";
import type {
	MetadataProvider,
	Providers,
	WorkMetadata,
} from "@/orpc/providers";

import { router } from "./index.ts";

type TestDb = Awaited<ReturnType<typeof freshDb>>;

const today = isoDay(new Date());

const metadataFor = (resolved: ResolveResult): WorkMetadata => ({
	backdropRef: undefined,
	cast: [],
	coverRef: undefined,
	ifYouLiked: [],
	nativeTitle: undefined,
	segments: resolved.segments.map((segment, index) => ({
		airedFrom: today,
		airedTo: today,
		episodes: segment.instalments.map((_locator, position) => ({
			airDate: index === 0 && position === 0 ? today : "2099-01-01",
			number: position + 1,
			title: `Episode ${position + 1}`,
		})),
		label: `Part ${index + 1}`,
		year: 2026,
	})),
	span: "",
	staff: [],
	studios: [],
	synopsis: "",
	title: `Work ${resolved.continuityId}`,
});

const titledProvider: MetadataProvider = {
	fetchWork: async (resolved) => {
		await Promise.resolve();
		return metadataFor(resolved);
	},
};

const providersUsing = (metadata: MetadataProvider): Providers => ({
	...defaultProviders,
	metadata: { anidb: metadata, tmdb: metadata },
});

const clientFor = (
	db: TestDb,
	userId: string | undefined,
	providers: Providers = providersUsing(titledProvider),
) =>
	createRouterClient(router, {
		context: {
			db,
			providers,
			resolveSession: () => (userId === undefined ? undefined : { id: userId }),
		} satisfies ORPCContext,
	});

const seededViewer = async () => {
	const db = await freshDb();
	await db
		.insert(user)
		.values({ email: "a@b.test", id: "user-1", name: "Ada" })
		.run();
	return db;
};

const track = async (
	db: TestDb,
	continuityId: string,
	status: "completed" | "watching" = "watching",
) => {
	await db
		.insert(watchStatus)
		.values({
			continuityKey: continuityId,
			rewatchCount: 0,
			status,
			updatedAt: new Date("2026-01-01T00:00:00Z"),
			userId: "user-1",
		})
		.run();
};

describe("calendar.list", () => {
	it("lists the next unwatched instalment airing today", async () => {
		const db = await seededViewer();
		const { continuityId } = await seedSpyXFamily(db);
		await track(db, continuityId);

		const days = await clientFor(db, "user-1").calendar.list();

		expect(days).toEqual([
			{
				date: today,
				episodes: [
					{
						airDate: today,
						continuityId,
						number: 1,
						partLabel: "Part 1",
						title: "Episode 1",
						workTitle: `Work ${continuityId}`,
					},
				],
			},
		]);
	});

	it("omits a watched instalment and completed works", async () => {
		const db = await seededViewer();
		const { continuityId } = await seedSpyXFamily(db);
		await track(db, continuityId, "completed");
		const [locator] = instalmentsOf(
			await createEngine(db).resolveContinuity(continuityId),
		);
		if (locator === undefined) {
			throw new Error("expected an instalment locator");
		}
		await db
			.insert(episodeProgress)
			.values({ instalmentLocator: locator, userId: "user-1" })
			.run();

		expect(await clientFor(db, "user-1").calendar.list()).toEqual([]);
	});

	it("rejects a viewer without a session", async () => {
		const db = await seededViewer();

		await expect(clientFor(db, undefined).calendar.list()).rejects.toThrow(
			/sign in/iu,
		);
	});
});
