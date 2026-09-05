import { describe, expect, it } from "vitest";

import { catalogueMetadata } from "@/db/schema";
import { freshDb } from "@/db/test-helpers";

import { createD1RefreshLeaseStore } from "./metadata-lease.ts";
import {
	createD1MetadataStore,
	createMemoryMetadataStore,
} from "./metadata-store.ts";

const sample = {
	coreFetchedAt: new Date("2026-09-01T00:00:00.000Z"),
	coreJson: '{"title":"X"}',
	entryKey: "tv:1396",
	freshnessClass: "continuing" as const,
	provider: "tmdb" as const,
	snapshotVersion: 3,
	userRefreshedAt: undefined,
	volatileFetchedAt: new Date("2026-09-01T06:00:00.000Z"),
	volatileJson: '{"span":"2020"}',
};

describe("memory metadata store", () => {
	it("round-trips a catalogue document", async () => {
		const store = createMemoryMetadataStore();
		await store.put(sample);
		expect(await store.get("tmdb", "tv:1396")).toEqual(sample);
		expect(await store.get("tmdb", "movie:1")).toBeUndefined();
	});
});

describe("d1 metadata store", () => {
	it("upserts on provider and entry key", async () => {
		const db = await freshDb();
		const store = createD1MetadataStore(db);
		await store.put(sample);
		await store.put({
			...sample,
			coreJson: '{"title":"Y"}',
			freshnessClass: "completed",
		});
		const row = await store.get("tmdb", "tv:1396");
		expect(row?.coreJson).toBe('{"title":"Y"}');
		expect(row?.freshnessClass).toBe("completed");
		const count = await db.select().from(catalogueMetadata).all();
		expect(count).toHaveLength(1);
	});
});

describe("refresh lease", () => {
	it("admits the first claim and rejects a second inside 24 hours", async () => {
		const db = await freshDb();
		const lease = createD1RefreshLeaseStore(db);
		const now = new Date("2026-09-05T12:00:00.000Z");
		expect(await lease.claim("continuity:1", now)).toEqual({ ok: true });
		const blocked = await lease.claim(
			"continuity:1",
			new Date(now.getTime() + 60 * 60 * 1000),
		);
		expect(blocked.ok).toBe(false);
		if (blocked.ok) {
			throw new Error("expected the second claim to be blocked");
		}
		const retryAt = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();
		expect(blocked.retryAt.toISOString()).toBe(retryAt);
	});

	it("admits a claim after 24 hours", async () => {
		const db = await freshDb();
		const lease = createD1RefreshLeaseStore(db);
		const now = new Date("2026-09-05T12:00:00.000Z");
		await lease.claim("continuity:1", now);
		const later = new Date(now.getTime() + 24 * 60 * 60 * 1000);
		expect(await lease.claim("continuity:1", later)).toEqual({ ok: true });
	});
});
