import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import {
	serviceCoverages,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import { continuityKey } from "@/engine/continuity/keys";
import type { SimklClient } from "@/engine/discovery";
import type { Identity } from "@/engine/identity.ts";
import { bootstrapFromIdentity } from "@/engine/ingest";
import type { IngestEnv } from "@/engine/ingest";
import { seedPendingCoverage } from "@/engine/overflow";
import { seedTmdbContinuity } from "@/engine/test-continuity";
import type { ORPCContext, SessionUser } from "@/orpc/context";
import { router } from "@/orpc/router";

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

describe("work.open", () => {
	it("returns ready with continuityId for a warm mapped title", async () => {
		const ingest = await ingestEnv(false);
		const { continuityId } = await seedTmdbContinuity(
			ingest.db,
			"movie",
			"603",
		);
		const bootstrap = await bootstrapFromIdentity(ingest.db, identity);
		if (bootstrap.kind !== "bootstrapped") {
			throw new Error("expected bootstrap");
		}
		await ingest.db.insert(serviceCoverages).values({
			baselineContinuity: `group:${bootstrap.group.groupId}`,
			revision: 1,
			state: "complete",
			targetService: "imdb",
		});
		const client = clientFor(undefined, ingest);

		await expect(
			client.work.open({ identity, profile: "movie" }),
		).resolves.toEqual({ continuityId, kind: "ready" });
	});

	it("bootstraps a cold title and returns pending with continuityId", async () => {
		const ingest = await ingestEnv();
		const client = clientFor(undefined, ingest);

		const result = await client.work.open({ identity, profile: "movie" });
		expect(result.kind).toBe("pending");
		if (result.kind === "pending") {
			expect(result.continuityId).toMatch(/^continuity:\d+$/u);
			expect(result.retryAfterSeconds).toBe(5);
			expect(result.statusUrl).toMatch(
				/^\/api\/engine\/status\/pending:[0-9a-z]+$/u,
			);
		}
		await expect(
			ingest.db.select().from(titleGroups).all(),
		).resolves.toHaveLength(1);
		await expect(
			ingest.db.select().from(serviceTitles).all(),
		).resolves.not.toEqual([]);
	});

	it("returns unknown without writing for an upstream miss", async () => {
		const ingest = await ingestEnv(false);
		const client = clientFor({ id: "member-1" }, ingest);

		await expect(
			client.work.open({ identity, profile: "movie" }),
		).resolves.toEqual({ kind: "unknown" });
		await expect(ingest.db.select().from(titleGroups).all()).resolves.toEqual(
			[],
		);
	});

	it("returns pending for warm pending coverage with continuityId", async () => {
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
		const client = clientFor(undefined, ingest);

		const result = await client.work.open({ identity, profile: "movie" });
		expect(result.kind).toBe("pending");
		if (result.kind !== "pending") {
			throw new Error("expected pending");
		}
		expect(result.continuityId).toBe(
			continuityKey(bootstrap.group.continuityId),
		);
		expect(result.retryAfterSeconds).toBe(5);
		expect(result.statusUrl).toMatch(
			/^\/api\/engine\/status\/pending:[0-9a-z]+$/u,
		);
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
		const client = clientFor(undefined, ingest);

		const result = await client.work.open({ identity, profile: "movie" });
		expect(result.kind).toBe("conflict");
		if (result.kind === "conflict") {
			expect(result.review).toMatch(/^review:[0-9a-z]+$/u);
		}
	});

	it("is available to signed-out callers", async () => {
		const ingest = await ingestEnv();
		const client = clientFor(undefined, ingest);
		await expect(
			client.work.open({ identity, profile: "movie" }),
		).resolves.toMatchObject({ kind: "pending" });
	});
});
