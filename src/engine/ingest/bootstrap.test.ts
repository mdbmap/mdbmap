import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";

import {
	continuities,
	continuitySegments,
	contentUnits,
	instalmentAssertions,
	serviceInstalments,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import { continuityKey } from "@/engine/continuity/keys.ts";
import type { SimklClient, SimklService } from "@/engine/discovery/simkl.ts";
import { anime } from "@/engine/discovery/test-fixtures.ts";
import type { CatalogueClient } from "@/engine/discovery/verify.ts";

import { bootstrapFromIdentity } from "./bootstrap.ts";
import { probeUpstream } from "./probe.ts";

const knownMal = { id: "50265", service: "mal" as const };
const knownIdentity = { kind: "title" as const, title: knownMal };
const unknownMal = { id: "99999999", service: "mal" as const };

const simklWith = (entries: ReturnType<typeof anime>[]): SimklClient => {
	const shaped = entries;
	const byExternal = (service: SimklService, serviceId: string) =>
		shaped.find((entry) => entry.externalIds[service] === serviceId);
	return {
		fetchEntry: async (simklId) => {
			await Promise.resolve();
			return shaped.find((entry) => entry.id === simklId);
		},
		findByExternalId: async (service, serviceId) => {
			await Promise.resolve();
			return byExternal(service, serviceId);
		},
	};
};

const kitsuClient = (knownIds: ReadonlySet<string>): CatalogueClient => ({
	fetchTitle: async (serviceId) => {
		await Promise.resolve();
		return knownIds.has(serviceId)
			? {
					format: "TV",
					instalmentCount: 12,
					releaseDate: undefined,
					title: "Fixture",
				}
			: undefined;
	},
});

describe("probeUpstream", () => {
	it("confirms a SIMKL-backed identity that exists upstream", async () => {
		const simkl = simklWith([anime("1", { mal: knownMal.id }, [])]);

		const result = await probeUpstream(knownMal, { simkl });

		expect(result).toEqual({ kind: "confirmed" });
	});

	it("refuses an unknown upstream identity without writing to D1", async () => {
		const db = await freshDb();
		const groupsBefore = await db.select().from(titleGroups).all();
		const simkl = simklWith([]);

		const result = await probeUpstream(unknownMal, { simkl });

		expect(result).toEqual({ kind: "refused", reason: "no-record" });
		expect(await db.select().from(titleGroups).all()).toEqual(groupsBefore);
	});

	it("queries SIMKL with bare id for TMDB titles", async () => {
		const tmdbMovie = {
			id: "123",
			namespace: "movie" as const,
			service: "tmdb" as const,
		};
		let lookupId: string | undefined;
		const simkl: SimklClient = {
			fetchEntry: async () => {
				await Promise.resolve();
				return;
			},
			findByExternalId: async (_service, serviceId) => {
				await Promise.resolve();
				lookupId = serviceId;
				return {
					externalIds: { tmdb: "movie:123" },
					id: "simkl-1",
					relations: [],
					title: "Fixture Film",
					type: "movie",
				};
			},
		};

		const result = await probeUpstream(tmdbMovie, { simkl });

		expect(lookupId).toBe("123");
		expect(result).toEqual({ kind: "confirmed" });
	});

	it("accepts anime SIMKL type for TMDB tv namespace", async () => {
		const tmdbTv = {
			id: "456",
			namespace: "tv" as const,
			service: "tmdb" as const,
		};
		const simkl: SimklClient = {
			fetchEntry: async () => {
				await Promise.resolve();
				return;
			},
			findByExternalId: async () => {
				await Promise.resolve();
				return {
					externalIds: { tmdb: "456" },
					id: "simkl-anime",
					relations: [],
					title: "Fixture Anime",
					type: "anime",
				};
			},
		};

		const result = await probeUpstream(tmdbTv, { simkl });

		expect(result).toEqual({ kind: "confirmed" });
	});

	it("refuses TMDB when SIMKL entry type mismatches namespace", async () => {
		const tmdbShow = {
			id: "456",
			namespace: "tv" as const,
			service: "tmdb" as const,
		};
		const simkl: SimklClient = {
			fetchEntry: async () => {
				await Promise.resolve();
				return;
			},
			findByExternalId: async () => {
				await Promise.resolve();
				return {
					externalIds: { tmdb: "456" },
					id: "simkl-2",
					relations: [],
					title: "Fixture Film",
					type: "movie",
				};
			},
		};

		const result = await probeUpstream(tmdbShow, { simkl });

		expect(result).toEqual({ kind: "refused", reason: "no-record" });
	});
	it("confirms a non-SIMKL identity through the catalogue client", async () => {
		const result = await probeUpstream(
			{ id: "42", service: "kitsu" },
			{ catalogues: { kitsu: kitsuClient(new Set(["42"])) } },
		);

		expect(result).toEqual({ kind: "confirmed" });
	});
});

describe("bootstrapFromIdentity", () => {
	it("creates hub spokes and continuity from an empty database", async () => {
		const db = await freshDb();

		const result = await bootstrapFromIdentity(db, knownIdentity);

		if (result.kind !== "bootstrapped") {
			throw new Error(`expected bootstrapped, got ${result.kind}`);
		}
		expect(result.group.baselineContinuity).toBe(
			`group:${result.group.groupId}`,
		);
		expect(continuityKey(result.group.continuityId)).toBe(
			`continuity:${result.group.continuityId}`,
		);

		const groups = await db.select().from(titleGroups).all();
		expect(groups).toHaveLength(1);
		expect(groups[0]?.source).toBe("release");

		const titles = await db.select().from(serviceTitles).all();
		expect(titles).toHaveLength(1);
		expect(titles[0]).toMatchObject({ service: "mal", serviceId: knownMal.id });

		const units = await db.select().from(contentUnits).all();
		expect(units).toHaveLength(1);

		const spokes = await db.select().from(serviceInstalments).all();
		expect(spokes).toHaveLength(1);
		expect(spokes[0]).toMatchObject({
			locator: "s1e1",
			locatorKind: "position",
		});

		const assertions = await db.select().from(instalmentAssertions).all();
		expect(assertions).toHaveLength(1);
		expect(assertions[0]).toMatchObject({
			confidence: "low",
			source: "bootstrap",
		});

		const segments = await db
			.select()
			.from(continuitySegments)
			.where(eq(continuitySegments.continuityId, result.group.continuityId))
			.all();
		expect(segments).toHaveLength(1);
		expect(segments[0]?.titleId).toBe(result.group.requestedTitleId);

		const continuityRows = await db.select().from(continuities).all();
		expect(continuityRows).toHaveLength(1);
	});

	it("refuses instalment identities", async () => {
		const db = await freshDb();

		const result = await bootstrapFromIdentity(db, {
			kind: "instalment",
			locator: { episode: 1, season: 1 },
			title: knownMal,
		});

		expect(result).toEqual({ kind: "refused", reason: "unsupported-identity" });
		expect(await db.select().from(titleGroups).all()).toHaveLength(0);
	});

	it("joins concurrent claims on the existing service_titles row", async () => {
		const db = await freshDb();

		const [first, second] = await Promise.all([
			bootstrapFromIdentity(db, knownIdentity),
			bootstrapFromIdentity(db, knownIdentity),
		]);

		if (first.kind !== "bootstrapped" || second.kind !== "bootstrapped") {
			throw new Error("expected both claims to bootstrap");
		}
		expect(first.group.groupId).toBe(second.group.groupId);
		expect(first.group.requestedTitleId).toBe(second.group.requestedTitleId);

		expect(await db.select().from(titleGroups).all()).toHaveLength(1);
		expect(await db.select().from(serviceTitles).all()).toHaveLength(1);
	});

	it("is idempotent when the service_titles row already exists", async () => {
		const db = await freshDb();
		const first = await bootstrapFromIdentity(db, knownIdentity);
		const second = await bootstrapFromIdentity(db, knownIdentity);

		if (first.kind !== "bootstrapped" || second.kind !== "bootstrapped") {
			throw new Error("expected both claims to bootstrap");
		}
		expect(second.group).toEqual(first.group);
		expect(await db.select().from(titleGroups).all()).toHaveLength(1);
	});
});

describe("claimGroup failure cleanup", () => {
	it("removes orphan rows when hub spoke setup fails", async () => {
		vi.doMock("@/engine/research/low-confidence-flag.ts", () => ({
			queueFlag: async () => {
				await Promise.resolve();
				throw new Error("queue failed");
			},
		}));
		vi.resetModules();
		const { bootstrapFromIdentity: bootstrapClaim } =
			await import("./bootstrap.ts");

		const db = await freshDb();
		await expect(
			bootstrapClaim(db, {
				kind: "title",
				title: { id: "77777", service: "mal" },
			}),
		).rejects.toThrow("queue failed");

		expect(await db.select().from(titleGroups).all()).toHaveLength(0);
		expect(await db.select().from(serviceTitles).all()).toHaveLength(0);
		expect(await db.select().from(contentUnits).all()).toHaveLength(0);

		vi.doUnmock("@/engine/research/low-confidence-flag.ts");
		vi.resetModules();
	});
});
