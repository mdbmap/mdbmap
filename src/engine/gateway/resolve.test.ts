import { beforeEach, describe, expect, it } from "vitest";

import {
	contentUnits,
	instalmentAssertions,
	serviceCoverages,
	serviceInstalments,
	serviceTitles,
	titleAssertions,
	titleGroupAliases,
	titleGroups,
} from "@/db/engine-schema";
import type { CoverageState, GroupSource } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";

import { noColdLookup } from "./cold-lookup.ts";
import type { ColdLookup } from "./cold-lookup.ts";
import { runMapping } from "./handler.ts";
import { resolveMapping } from "./resolve.ts";

type Db = ReturnType<typeof freshDb>;

const one = <Row>(rows: readonly Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected an inserted row");
	}
	return row;
};

const seedGroup = (db: Db, source: GroupSource = "t1-structure") =>
	one(db.insert(titleGroups).values({ source }).returning().all());

const seedTitle = (db: Db, groupId: number, service: string, serviceId: string) =>
	one(
		db.insert(serviceTitles).values({ groupId, service, serviceId }).returning().all(),
	);

const linkTitles = (db: Db, firstId: number, secondId: number, source: GroupSource) => {
	db.insert(titleAssertions)
		.values({
			confidence: "high",
			source: source === "release" ? "t1-structure" : source,
			titleAId: Math.min(firstId, secondId),
			titleBId: Math.max(firstId, secondId),
		})
		.run();
};

const seedCoverage = (db: Db, groupId: number, targetService: string, state: CoverageState) => {
	db.insert(serviceCoverages)
		.values({
			baselineContinuity: `group:${groupId}`,
			revision: 1,
			state,
			targetService,
		})
		.run();
};

const seedInstalment = (db: Db, titleId: number, locator: string) =>
	one(
		db
			.insert(serviceInstalments)
			.values({ locator, locatorKind: "position", titleId })
			.returning()
			.all(),
	);

const seedUnit = (db: Db) => one(db.insert(contentUnits).values({}).returning().all());

const coverInstalment = (db: Db, instalmentId: number, unitId: number) => {
	db.insert(instalmentAssertions)
		.values({ confidence: "high", instalmentId, source: "t3-episode", unitId })
		.run();
};

describe("mapping gateway resolution", () => {
	let db: Db;

	beforeEach(() => {
		db = freshDb();
	});

	it("returns 200 with counterpart arrays for a known id", async () => {
		const group = seedGroup(db);
		const source = seedTitle(db, group.id, "tmdb", "movie:603");
		const target = seedTitle(db, group.id, "imdb", "tt0133093");
		linkTitles(db, source.id, target.id, "t1-structure");

		const outcome = await resolveMapping(db, "movie", "tmdb:603", noColdLookup);

		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") {
			return;
		}
		expect(outcome.body.input).toBe("tmdb:603");
		const { imdb } = outcome.body.mappings;
		expect(imdb?.status).toBe("matched");
		expect(imdb?.counterparts.map((counterpart) => counterpart.id)).toEqual(["tt0133093"]);
	});

	it("maps in the reverse direction from the same graph", async () => {
		const group = seedGroup(db);
		const source = seedTitle(db, group.id, "tmdb", "movie:603");
		const target = seedTitle(db, group.id, "imdb", "tt0133093");
		linkTitles(db, source.id, target.id, "t1-structure");

		const outcome = await resolveMapping(db, "movie", "tt0133093", noColdLookup);

		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") {
			return;
		}
		expect(outcome.body.mappings.tmdb?.counterparts.map((counterpart) => counterpart.id)).toEqual([
			"tmdb:603",
		]);
	});

	it("treats a known id with no counterpart as a successful empty result", async () => {
		const group = seedGroup(db);
		seedTitle(db, group.id, "tmdb", "movie:603");

		const outcome = await resolveMapping(db, "movie", "tmdb:603", noColdLookup);

		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") {
			return;
		}
		expect(Object.keys(outcome.body.mappings)).toHaveLength(0);
	});

	it("rejects a malformed id with the expected shape", async () => {
		const outcome = await resolveMapping(db, "movie", "not-an-id", noColdLookup);

		expect(outcome.kind).toBe("malformed");
		if (outcome.kind !== "malformed") {
			return;
		}
		expect(outcome.expected.length).toBeGreaterThan(0);
	});

	it("rejects a TMDB id under /anime at the id boundary", async () => {
		const outcome = await resolveMapping(db, "anime", "tmdb:603", noColdLookup);

		expect(outcome.kind).toBe("malformed");
	});

	it("returns 404 for an id unknown to the graph", async () => {
		const outcome = await resolveMapping(db, "movie", "tmdb:999", noColdLookup);

		expect(outcome.kind).toBe("unknown");
	});

	it("hands a cold miss to the cold-lookup seam for a 202", async () => {
		const build: ColdLookup = {
			begin: () => ({
				build: { retryAfterSeconds: 3, statusUrl: "/api/engine/status/opaque" },
				kind: "started",
			}),
		};

		const outcome = await resolveMapping(db, "movie", "tmdb:999", build);

		expect(outcome.kind).toBe("pending");
		if (outcome.kind !== "pending") {
			return;
		}
		expect(outcome.statusUrl).toBe("/api/engine/status/opaque");
		expect(outcome.retryAfterSeconds).toBe(3);
	});

	it("returns 409 with an opaque review reference for a blocking conflict", async () => {
		const group = seedGroup(db);
		seedTitle(db, group.id, "tmdb", "movie:603");
		seedCoverage(db, group.id, "imdb", "conflict");

		const outcome = await resolveMapping(db, "movie", "tmdb:603", noColdLookup);

		expect(outcome.kind).toBe("conflict");
		if (outcome.kind !== "conflict") {
			return;
		}
		expect(outcome.review.startsWith("review:")).toBe(true);
		expect(outcome.body.mappings.imdb?.status).toBe("conflict");
	});

	it("returns 202 with a status URL for a seeded pending build", async () => {
		const group = seedGroup(db);
		seedTitle(db, group.id, "tmdb", "movie:603");
		seedCoverage(db, group.id, "imdb", "pending");

		const outcome = await resolveMapping(db, "movie", "tmdb:603", noColdLookup);

		expect(outcome.kind).toBe("pending");
		if (outcome.kind !== "pending") {
			return;
		}
		expect(outcome.retryAfterSeconds).toBeGreaterThan(0);
		expect(outcome.statusUrl.length).toBeGreaterThan(0);
		expect(outcome.body.mappings.imdb?.status).toBe("pending");
	});

	it("serves a usable target at 200 while another target is still pending", async () => {
		const group = seedGroup(db);
		const source = seedTitle(db, group.id, "tmdb", "movie:603");
		const target = seedTitle(db, group.id, "imdb", "tt0133093");
		linkTitles(db, source.id, target.id, "t1-structure");
		seedCoverage(db, group.id, "tvdb", "pending");

		const outcome = await resolveMapping(db, "movie", "tmdb:603", noColdLookup);

		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") {
			return;
		}
		expect(outcome.body.mappings.imdb?.status).toBe("matched");
		expect(outcome.body.mappings.tvdb?.status).toBe("pending");
	});

	it("serves a stale complete revision even while a replacement build runs", async () => {
		const group = seedGroup(db);
		const source = seedTitle(db, group.id, "tmdb", "movie:603");
		const target = seedTitle(db, group.id, "imdb", "tt0133093");
		linkTitles(db, source.id, target.id, "t1-structure");
		seedCoverage(db, group.id, "imdb", "complete");
		db.insert(serviceCoverages)
			.values({
				baselineContinuity: `group:${group.id}`,
				revision: 2,
				state: "pending",
				targetService: "imdb",
			})
			.run();

		const outcome = await resolveMapping(db, "movie", "tmdb:603", noColdLookup);

		expect(outcome.kind).toBe("ok");
	});

	it("follows a group alias to the survivor's members", async () => {
		const survivor = seedGroup(db);
		const retired = seedGroup(db);
		const source = seedTitle(db, retired.id, "tmdb", "movie:603");
		const target = seedTitle(db, survivor.id, "imdb", "tt0133093");
		linkTitles(db, source.id, target.id, "t1-structure");
		db.insert(titleGroupAliases)
			.values({ retiredGroupId: retired.id, survivorGroupId: survivor.id })
			.run();

		const outcome = await resolveMapping(db, "movie", "tmdb:603", noColdLookup);

		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") {
			return;
		}
		expect(outcome.body.mappings.imdb?.counterparts.map((counterpart) => counterpart.id)).toEqual([
			"tt0133093",
		]);
	});
});

describe("mapping gateway HTTP responses", () => {
	let db: Db;

	beforeEach(() => {
		db = freshDb();
	});

	it("answers a known movie id with a 200 JSON body", async () => {
		const group = seedGroup(db);
		const source = seedTitle(db, group.id, "tmdb", "movie:603");
		const target = seedTitle(db, group.id, "imdb", "tt0133093");
		linkTitles(db, source.id, target.id, "t1-structure");

		const response = await runMapping("movie", "tmdb:603", { db });

		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toContain("application/json");
	});

	it("sets Retry-After and 202 for a pending build", async () => {
		const group = seedGroup(db);
		seedTitle(db, group.id, "tmdb", "movie:603");
		seedCoverage(db, group.id, "imdb", "pending");

		const response = await runMapping("movie", "tmdb:603", { db });

		expect(response.status).toBe(202);
		expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
	});

	it("omits Retry-After and returns 409 for a conflict", async () => {
		const group = seedGroup(db);
		seedTitle(db, group.id, "tmdb", "movie:603");
		seedCoverage(db, group.id, "imdb", "conflict");

		const response = await runMapping("movie", "tmdb:603", { db });

		expect(response.status).toBe(409);
		expect(response.headers.get("retry-after")).toBeNull();
	});

	it("returns 400 for a malformed id and 404 for an unknown id", async () => {
		const malformed = await runMapping("movie", "not-an-id", { db });
		const unknown = await runMapping("movie", "tmdb:999", { db });

		expect(malformed.status).toBe(400);
		expect(unknown.status).toBe(404);
	});
});

describe("mapping gateway instalment resolution", () => {
	let db: Db;

	beforeEach(() => {
		db = freshDb();
	});

	it("maps an episode to its counterpart instalment through a shared content unit", async () => {
		const group = seedGroup(db);
		const source = seedTitle(db, group.id, "tmdb", "tv:1396");
		const target = seedTitle(db, group.id, "imdb", "tt0903747");
		linkTitles(db, source.id, target.id, "t1-structure");
		const sourceEpisode = one(
			db
				.insert(serviceInstalments)
				.values({ locator: "s1e1", locatorKind: "position", titleId: source.id })
				.returning()
				.all(),
		);
		const targetEpisode = one(
			db
				.insert(serviceInstalments)
				.values({ locator: "s1e1", locatorKind: "position", titleId: target.id })
				.returning()
				.all(),
		);
		const unit = one(db.insert(contentUnits).values({}).returning().all());
		db.insert(instalmentAssertions)
			.values(
				[sourceEpisode, targetEpisode].map((episode) => ({
					confidence: "high" as const,
					instalmentId: episode.id,
					source: "t3-episode" as const,
					unitId: unit.id,
				})),
			)
			.run();

		const outcome = await resolveMapping(db, "series", "tmdb:1396:1:1", noColdLookup);

		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") {
			return;
		}
		expect(outcome.body.input).toBe("tmdb:1396:1:1");
		expect(outcome.body.mappings.imdb?.counterparts.map((counterpart) => counterpart.id)).toEqual([
			"tt0903747:1:1",
		]);
	});

	it("returns 202 for an episodic id whose anchor group has a pending target", async () => {
		const group = seedGroup(db);
		const source = seedTitle(db, group.id, "tmdb", "tv:1396");
		db.insert(serviceInstalments)
			.values({ locator: "s1e1", locatorKind: "position", titleId: source.id })
			.run();
		seedCoverage(db, group.id, "imdb", "pending");

		const outcome = await resolveMapping(db, "series", "tmdb:1396:1:1", noColdLookup);

		expect(outcome.kind).toBe("pending");
		if (outcome.kind !== "pending") {
			return;
		}
		expect(outcome.statusUrl.length).toBeGreaterThan(0);
		expect(outcome.body.mappings.imdb?.status).toBe("pending");
	});

	it("returns 409 for an episodic id whose anchor group has a blocking conflict", async () => {
		const group = seedGroup(db);
		const source = seedTitle(db, group.id, "tmdb", "tv:1396");
		db.insert(serviceInstalments)
			.values({ locator: "s1e1", locatorKind: "position", titleId: source.id })
			.run();
		seedCoverage(db, group.id, "imdb", "conflict");

		const outcome = await resolveMapping(db, "series", "tmdb:1396:1:1", noColdLookup);

		expect(outcome.kind).toBe("conflict");
		if (outcome.kind !== "conflict") {
			return;
		}
		expect(outcome.review.startsWith("review:")).toBe(true);
		expect(outcome.body.mappings.imdb?.status).toBe("conflict");
	});
});

describe("mapping gateway title-level instalments", () => {
	let db: Db;

	beforeEach(() => {
		db = freshDb();
	});

	it("carries the requested title's instalments with per-instalment mappings", async () => {
		const group = seedGroup(db);
		const source = seedTitle(db, group.id, "tmdb", "tv:1396");
		const target = seedTitle(db, group.id, "imdb", "tt0903747");
		linkTitles(db, source.id, target.id, "t1-structure");
		const sourceEpisode = seedInstalment(db, source.id, "s1e1");
		const targetEpisode = seedInstalment(db, target.id, "s1e1");
		const unit = seedUnit(db);
		coverInstalment(db, sourceEpisode.id, unit.id);
		coverInstalment(db, targetEpisode.id, unit.id);

		const outcome = await resolveMapping(db, "series", "tmdb:1396", noColdLookup);

		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") {
			return;
		}
		expect(outcome.body.instalments?.map((entry) => entry.input)).toEqual(["tmdb:1396:1:1"]);
		const [entry] = outcome.body.instalments ?? [];
		expect(entry?.mappings.imdb?.counterparts.map((counterpart) => counterpart.id)).toEqual([
			"tt0903747:1:1",
		]);
		expect(outcome.body.mappings.imdb?.counterparts[0]?.supportingInstalment).toBeUndefined();
	});

	it("names the supporting instalment for a non-coextensive counterpart", async () => {
		const group = seedGroup(db);
		const source = seedTitle(db, group.id, "tmdb", "tv:1396");
		const target = seedTitle(db, group.id, "imdb", "tt0903747");
		linkTitles(db, source.id, target.id, "t1-structure");
		const firstUnit = seedUnit(db);
		const secondUnit = seedUnit(db);
		const sourceOne = seedInstalment(db, source.id, "s1e1");
		const sourceTwo = seedInstalment(db, source.id, "s1e2");
		const targetOne = seedInstalment(db, target.id, "s1e1");
		coverInstalment(db, sourceOne.id, firstUnit.id);
		coverInstalment(db, sourceTwo.id, secondUnit.id);
		coverInstalment(db, targetOne.id, firstUnit.id);

		const outcome = await resolveMapping(db, "series", "tmdb:1396", noColdLookup);

		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") {
			return;
		}
		const counterpart = outcome.body.mappings.imdb?.counterparts[0];
		expect(counterpart?.id).toBe("tt0903747");
		expect(counterpart?.supportingInstalment).toBe("tmdb:1396:1:1");
		expect(outcome.body.instalments?.map((entry) => entry.input)).toEqual([
			"tmdb:1396:1:1",
			"tmdb:1396:1:2",
		]);
	});

	it("names the counterpart instalment when the request is a strict subset of it", async () => {
		const group = seedGroup(db);
		const source = seedTitle(db, group.id, "tmdb", "tv:1396");
		const target = seedTitle(db, group.id, "imdb", "tt0903747");
		linkTitles(db, source.id, target.id, "t1-structure");
		const firstUnit = seedUnit(db);
		const secondUnit = seedUnit(db);
		const sourceOne = seedInstalment(db, source.id, "s1e1");
		const targetOne = seedInstalment(db, target.id, "s1e1");
		const targetTwo = seedInstalment(db, target.id, "s1e2");
		coverInstalment(db, sourceOne.id, firstUnit.id);
		coverInstalment(db, targetOne.id, firstUnit.id);
		coverInstalment(db, targetTwo.id, secondUnit.id);

		const outcome = await resolveMapping(db, "series", "tmdb:1396", noColdLookup);

		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") {
			return;
		}
		const counterpart = outcome.body.mappings.imdb?.counterparts[0];
		expect(counterpart?.id).toBe("tt0903747:1:1");
		expect(counterpart?.supportingInstalment).toBeUndefined();
	});

	it("serves the derived group source and per-instalment sources with fallback", async () => {
		const group = seedGroup(db, "t1-structure");
		const source = seedTitle(db, group.id, "tmdb", "tv:1396");
		const target = seedTitle(db, group.id, "imdb", "tt0903747");
		linkTitles(db, source.id, target.id, "manual");
		const sourceEpisode = seedInstalment(db, source.id, "s1e1");
		const targetEpisode = seedInstalment(db, target.id, "s1e1");
		const unit = seedUnit(db);
		coverInstalment(db, sourceEpisode.id, unit.id);
		coverInstalment(db, targetEpisode.id, unit.id);
		seedInstalment(db, source.id, "s1e2");

		const outcome = await resolveMapping(db, "series", "tmdb:1396", noColdLookup);

		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") {
			return;
		}
		const { imdb } = outcome.body.mappings;
		expect(imdb?.status).toBe("matched");
		if (imdb?.status !== "matched") {
			return;
		}
		expect(imdb.source).toBe("manual");
		const linked = outcome.body.instalments?.find((entry) => entry.input === "tmdb:1396:1:1");
		const unlinked = outcome.body.instalments?.find((entry) => entry.input === "tmdb:1396:1:2");
		expect(linked?.source).toBe("t3-episode");
		expect(unlinked?.source).toBe("manual");
	});
});

describe("mapping gateway assertion integrity", () => {
	let db: Db;

	beforeEach(() => {
		db = freshDb();
	});

	it("does not fabricate a high assertion for a group-co-membership-only counterpart", async () => {
		const group = seedGroup(db, "t1-structure");
		seedTitle(db, group.id, "tmdb", "movie:603");
		seedTitle(db, group.id, "imdb", "tt0133093");

		const outcome = await resolveMapping(db, "movie", "tmdb:603", noColdLookup);

		expect(outcome.kind).toBe("ok");
		if (outcome.kind !== "ok") {
			return;
		}
		const { imdb } = outcome.body.mappings;
		expect(imdb?.status).toBe("matched");
		if (imdb?.status !== "matched") {
			return;
		}
		expect(imdb.confidence).toBe("low");
		expect(
			imdb.counterparts.every((counterpart) =>
				counterpart.assertionPath.every((assertion) => assertion.confidence !== "high"),
			),
		).toBe(true);
	});
});
