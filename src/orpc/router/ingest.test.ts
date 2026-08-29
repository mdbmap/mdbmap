import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import {
	serviceCoverages,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import type { SimklClient } from "@/engine/discovery";
import type { Identity } from "@/engine/identity.ts";
import { bootstrapFromIdentity } from "@/engine/ingest";
import type { IngestEnv } from "@/engine/ingest";
import { seedPendingCoverage } from "@/engine/overflow";
import type { ORPCContext, SessionUser } from "@/orpc/context";
import { router } from "@/orpc/router";
import { IngestStartInput } from "@/orpc/schema";

const identity = {
	kind: "title",
	title: { id: "603", namespace: "movie", service: "tmdb" },
} satisfies Identity;

const stubCatalogue: SimklClient = {
	fetchEntry: async (): Promise<undefined> => {
		await Promise.resolve();
		return;
	},
	findByExternalId: () => ({
		externalIds: { imdb: "tt0133093", tmdb: "603" },
		firstAirDate: "1999-03-31",
		id: "1",
		relations: [],
		title: "The Matrix",
		type: "movie",
	}),
};

const ingestEnv = async (probeExists = true): Promise<IngestEnv> => ({
	catalogue: {
		simkl: probeExists ? stubCatalogue : undefined,
		verification: {},
	},
	db: await freshDb(),
	dispatcher: undefined,
	structuralDiscovery: undefined,
});

const clientFor = (user: SessionUser | undefined, ingest: IngestEnv) =>
	createRouterClient(router, {
		context: {
			db: ingest.db,
			resolveIngest: () => ingest,
			resolveSession: () => user,
		} satisfies ORPCContext,
	});

describe("admin ingest.start", () => {
	it("starts ingest for an admin with a stubbed catalogue", async () => {
		const ingest = await ingestEnv();
		const client = clientFor({ id: "admin-1", role: "admin" }, ingest);

		const result = await client.ingest.start({ identity, profile: "movie" });
		expect(result.kind).toBe("pending");
		if (result.kind === "pending") {
			expect(result.retryAfterSeconds).toBe(5);
			expect(result.statusUrl).toMatch(
				/^\/api\/engine\/status\/pending:[0-9a-z]+$/u,
			);
		}
	});

	it("rejects a signed-in member", async () => {
		const ingest = await ingestEnv();
		const client = clientFor({ id: "member-1" }, ingest);

		await expect(
			client.ingest.start({ identity, profile: "movie" }),
		).rejects.toMatchObject({ code: "FORBIDDEN" });
	});

	it("rejects an unauthenticated caller", async () => {
		const ingest = await ingestEnv();
		const client = clientFor(undefined, ingest);

		await expect(
			client.ingest.start({ identity, profile: "movie" }),
		).rejects.toMatchObject({ code: "UNAUTHORIZED" });
	});

	it("returns unknown without writing for an upstream miss", async () => {
		const ingest = await ingestEnv(false);
		const client = clientFor({ id: "admin-1", role: "admin" }, ingest);

		await expect(
			client.ingest.start({ identity, profile: "movie" }),
		).resolves.toEqual({ kind: "unknown" });
		await expect(ingest.db.select().from(titleGroups).all()).resolves.toEqual(
			[],
		);
		await expect(ingest.db.select().from(serviceTitles).all()).resolves.toEqual(
			[],
		);
		await expect(
			ingest.db.select().from(serviceCoverages).all(),
		).resolves.toEqual([]);
	});

	it("returns pending for a warm graph without calling upstream", async () => {
		const ingest = await ingestEnv(false);
		const bootstrap = await bootstrapFromIdentity(ingest.db, identity);
		if (bootstrap.kind !== "bootstrapped") {
			throw new Error("expected bootstrap");
		}
		await seedPendingCoverage(
			ingest.db,
			`group:${bootstrap.group.groupId}`,
			1,
			"imdb",
		);
		const client = clientFor({ id: "admin-1", role: "admin" }, ingest);

		const result = await client.ingest.start({ identity, profile: "movie" });
		expect(result.kind).toBe("pending");
	});

	it("returns conflict for warm graph coverage in conflict", async () => {
		const ingest = await ingestEnv(false);
		const bootstrap = await bootstrapFromIdentity(ingest.db, identity);
		if (bootstrap.kind !== "bootstrapped") {
			throw new Error("expected bootstrap");
		}
		await ingest.db.insert(serviceCoverages).values({
			baselineContinuity: `group:${bootstrap.group.groupId}`,
			revision: 1,
			state: "conflict",
			targetService: "imdb",
		});
		const client = clientFor({ id: "admin-1", role: "admin" }, ingest);

		const result = await client.ingest.start({ identity, profile: "movie" });
		expect(result.kind).toBe("conflict");
		if (result.kind === "conflict") {
			expect(result.review).toMatch(/^review:[0-9a-z]+$/u);
		}
	});

	it("falls through when warm links are for other services than the profile targets", async () => {
		const ingest = await ingestEnv();
		const animeIdentity = {
			kind: "title" as const,
			title: { id: "1", service: "mal" as const },
		};
		const bootstrap = await bootstrapFromIdentity(ingest.db, animeIdentity);
		if (bootstrap.kind !== "bootstrapped") {
			throw new Error("expected bootstrap");
		}
		await ingest.db.insert(serviceCoverages).values({
			baselineContinuity: `group:${bootstrap.group.groupId}`,
			revision: 1,
			state: "complete",
			targetService: "tmdb",
		});
		const client = clientFor({ id: "admin-1", role: "admin" }, ingest);

		const result = await client.ingest.start({
			identity: animeIdentity,
			profile: "anime",
		});
		expect(result.kind).not.toBe("complete");
	});
});

describe("admin ingest.start input validation", () => {
	it("rejects an instalment identity", () => {
		const result = IngestStartInput.safeParse({
			identity: {
				kind: "instalment",
				locator: { episode: 1, season: 1 },
				title: { id: "603", namespace: "movie", service: "tmdb" },
			},
			profile: "movie",
		});
		expect(result.success).toBe(false);
	});

	it("rejects an unplannable identity and profile pair", () => {
		const result = IngestStartInput.safeParse({
			identity: { kind: "title", title: { id: "1", service: "mal" } },
			profile: "movie",
		});
		expect(result.success).toBe(false);
	});

	it("rejects a tmdb title under the anime profile", () => {
		const result = IngestStartInput.safeParse({
			identity: {
				kind: "title",
				title: { id: "603", namespace: "movie", service: "tmdb" },
			},
			profile: "anime",
		});
		expect(result.success).toBe(false);
	});

	it("rejects a tmdb namespace mismatch for the profile", () => {
		const result = IngestStartInput.safeParse({
			identity: {
				kind: "title",
				title: { id: "603", namespace: "movie", service: "tmdb" },
			},
			profile: "series",
		});
		expect(result.success).toBe(false);
	});

	it("rejects a non-canonical imdb id", () => {
		const result = IngestStartInput.safeParse({
			identity: { kind: "title", title: { id: "0133093", service: "imdb" } },
			profile: "movie",
		});
		expect(result.success).toBe(false);
	});

	it("rejects a non-numeric service id", () => {
		const result = IngestStartInput.safeParse({
			identity: { kind: "title", title: { id: "abc", service: "anilist" } },
			profile: "anime",
		});
		expect(result.success).toBe(false);
	});
});
