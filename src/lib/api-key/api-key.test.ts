import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { apiKey } from "@/db/schema";
import { freshDb } from "@/db/test-helpers";

import { hashApiKeySecret } from "./hash.ts";
import { issueApiKey, revokeApiKey, verifyApiKey } from "./index.ts";

describe("issueApiKey", () => {
	it("returns the full secret once and persists only its SHA-256 hash", async () => {
		const db = await freshDb();
		const issued = await issueApiKey(db, { label: "ci" });

		expect(issued.secret).toMatch(/^mdbmap_/u);

		const rows = await db.select().from(apiKey).where(eq(apiKey.id, issued.id)).all();
		const [row] = rows;
		expect(row?.keyHash).toBe(await hashApiKeySecret(issued.secret));
		expect(row?.keyHash).not.toBe(issued.secret);
	});

	it("defaults to the free plan", async () => {
		const db = await freshDb();
		const issued = await issueApiKey(db, { label: "ci" });
		expect(issued.plan).toBe("free");
	});

	it("honours an explicit plan", async () => {
		const db = await freshDb();
		const issued = await issueApiKey(db, { label: "ci", plan: "pro" });
		expect(issued.plan).toBe("pro");
	});
});

describe("verifyApiKey", () => {
	it("resolves the record id and plan for a correct key", async () => {
		const db = await freshDb();
		const issued = await issueApiKey(db, { label: "ci", plan: "pro" });

		await expect(verifyApiKey(db, issued.secret)).resolves.toEqual({
			id: issued.id,
			plan: "pro",
		});
	});

	it("rejects a wrong key", async () => {
		const db = await freshDb();
		await issueApiKey(db, { label: "ci" });

		await expect(verifyApiKey(db, "mdbmap_not-a-real-key")).resolves.toBeUndefined();
	});

	it("rejects a revoked key without changing its revocation timestamp", async () => {
		const db = await freshDb();
		const issued = await issueApiKey(db, { label: "ci" });
		const revokedAt = new Date("2026-01-01T00:00:00.000Z");
		await db.update(apiKey).set({ revokedAt }).where(eq(apiKey.id, issued.id)).run();

		await revokeApiKey(db, issued.id);

		const rows = await db.select().from(apiKey).where(eq(apiKey.id, issued.id)).all();
		expect(rows[0]?.revokedAt).toEqual(revokedAt);
		await expect(verifyApiKey(db, issued.secret)).resolves.toBeUndefined();
	});
});
