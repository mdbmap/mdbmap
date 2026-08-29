import { describe, expect, it } from "vitest";

import { serviceCoverages } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import type {
	DiscoveryClients,
	EnumeratedTitle,
	ServiceRef,
} from "@/engine/discovery/structural.ts";
import { readGraph } from "@/engine/gateway/read.ts";
import type { InstalmentFacts } from "@/engine/matcher";
import { locator, regular, streamOf } from "@/engine/matcher/test-fixtures.ts";
import {
	coverageStateFor,
	groupCoverageKey,
	seedPendingCoverage,
} from "@/engine/overflow/coverage.ts";

import { bootstrapFromIdentity } from "./bootstrap.ts";
import { fetchTargetStream } from "./phases.ts";
import { finishPublish, runSingleTargetPublish } from "./publish.ts";

const knownMal = { id: "50265", service: "mal" as const };
const knownIdentity = { kind: "title" as const, title: knownMal };

const ref = (service: string, serviceId: string): ServiceRef => ({
	service,
	serviceId,
});

const factsOf = (
	entries: readonly (readonly [string, InstalmentFacts])[],
): ReadonlyMap<ReturnType<typeof locator>, InstalmentFacts> => {
	const map = new Map<ReturnType<typeof locator>, InstalmentFacts>();
	for (const [raw, fact] of entries) {
		map.set(locator(raw), fact);
	}
	return map;
};

const malTitle: EnumeratedTitle = {
	facts: factsOf([
		["s1e1", { airDate: "2022-04-09", title: "Operation Strix" }],
	]),
	stream: streamOf([regular("s1e1")]),
};

const anilistTitle: EnumeratedTitle = {
	facts: factsOf([
		["s1e1", { airDate: "2022-04-09", title: "Operation Strix" }],
	]),
	stream: streamOf([regular("s1e1")]),
};

const publishClients = (): DiscoveryClients => ({
	externalIds: {
		describe: (title) => {
			if (title.service === "mal" && title.serviceId === knownMal.id) {
				return {
					externalIds: [ref("anilist", "140960")],
					firstAirDate: "2022-04-09",
				};
			}
			if (title.service === "anilist" && title.serviceId === "140960") {
				return {
					externalIds: [ref("mal", knownMal.id)],
					firstAirDate: "2022-04-09",
				};
			}
			return { externalIds: [], firstAirDate: undefined };
		},
	},
	find: {
		find: () => [ref("anilist", "140960")],
	},
	instalments: {
		enumerate: (title) => {
			if (title.service === "mal") {
				return malTitle;
			}
			if (title.service === "anilist") {
				return anilistTitle;
			}
			return { facts: factsOf([]), stream: streamOf([]) };
		},
	},
});

describe("runSingleTargetPublish", () => {
	it("bootstraps and publishes one target so readGraph returns a matched link", async () => {
		const db = await freshDb();
		const bootstrapped = await bootstrapFromIdentity(db, knownIdentity);
		if (bootstrapped.kind !== "bootstrapped") {
			throw new Error(`expected bootstrapped, got ${bootstrapped.kind}`);
		}

		const result = await runSingleTargetPublish(db, {
			anchor: knownMal,
			clients: { discovery: publishClients() },
			group: bootstrapped.group,
			targetService: "anilist",
		});

		expect(result).toEqual({
			groupId: bootstrapped.group.groupId,
			kind: "published",
		});

		const coverage = await coverageStateFor(
			db,
			groupCoverageKey(bootstrapped.group.groupId),
			1,
			"anilist",
		);
		expect(coverage).toBe("complete");

		const graph = await readGraph(db, knownIdentity);
		if (!graph.found) {
			throw new Error("expected graph read after publish");
		}
		const anilist = graph.answer.links.get("anilist");
		expect(anilist?.status).toBe("matched");
		if (anilist?.status === "matched") {
			expect(anilist.counterparts[0]?.identity).toMatchObject({
				kind: "title",
				title: { id: "140960", service: "anilist" },
			});
		}
	});

	it("marks coverage complete when the target has no discovered counterpart", async () => {
		const db = await freshDb();
		const bootstrapped = await bootstrapFromIdentity(db, knownIdentity);
		if (bootstrapped.kind !== "bootstrapped") {
			throw new Error(`expected bootstrapped, got ${bootstrapped.kind}`);
		}

		const isolatedClients: DiscoveryClients = {
			externalIds: {
				describe: () => ({ externalIds: [], firstAirDate: undefined }),
			},
			find: { find: () => [] },
			instalments: {
				enumerate: () => ({ facts: factsOf([]), stream: streamOf([]) }),
			},
		};

		const result = await runSingleTargetPublish(db, {
			anchor: knownMal,
			clients: { discovery: isolatedClients },
			group: bootstrapped.group,
			targetService: "anilist",
		});

		expect(result).toEqual({
			kind: "refused",
			reason: "unavailable-target",
		});

		const coverage = await coverageStateFor(
			db,
			groupCoverageKey(bootstrapped.group.groupId),
			1,
			"anilist",
		);
		expect(coverage).toBe("complete");
	});

	it("is idempotent when publish is retried", async () => {
		const db = await freshDb();
		const bootstrapped = await bootstrapFromIdentity(db, knownIdentity);
		if (bootstrapped.kind !== "bootstrapped") {
			throw new Error(`expected bootstrapped, got ${bootstrapped.kind}`);
		}
		const input = {
			anchor: knownMal,
			clients: { discovery: publishClients() },
			group: bootstrapped.group,
			targetService: "anilist" as const,
		};

		const first = await runSingleTargetPublish(db, input);
		const second = await runSingleTargetPublish(db, input);

		expect(first).toEqual(second);
		expect(await db.select().from(serviceCoverages).all()).toHaveLength(1);
	});

	it("marks coverage open when the published ladder still has pending tails", async () => {
		const db = await freshDb();
		const bootstrapped = await bootstrapFromIdentity(db, knownIdentity);
		if (bootstrapped.kind !== "bootstrapped") {
			throw new Error(`expected bootstrapped, got ${bootstrapped.kind}`);
		}
		const continuity = groupCoverageKey(bootstrapped.group.groupId);
		await seedPendingCoverage(db, continuity, 1, "anilist");

		const result = await finishPublish(db, {
			continuity,
			groupId: bootstrapped.group.groupId,
			ladderComplete: false,
			revision: 1,
			targetService: "anilist",
		});

		expect(result).toEqual({
			groupId: bootstrapped.group.groupId,
			kind: "published",
		});
		expect(await coverageStateFor(db, continuity, 1, "anilist")).toBe("open");
	});

	it("refuses without coverage when the target is not enumerable", async () => {
		const db = await freshDb();
		const bootstrapped = await bootstrapFromIdentity(db, knownIdentity);
		if (bootstrapped.kind !== "bootstrapped") {
			throw new Error(`expected bootstrapped, got ${bootstrapped.kind}`);
		}

		const result = await runSingleTargetPublish(db, {
			anchor: knownMal,
			clients: { discovery: publishClients() },
			group: bootstrapped.group,
			targetService: "tmdb",
		});

		expect(result).toEqual({
			kind: "refused",
			reason: "not-enumerable",
		});
		const coverage = await coverageStateFor(
			db,
			groupCoverageKey(bootstrapped.group.groupId),
			1,
			"tmdb",
		);
		expect(coverage).toBeUndefined();
	});

	it("marks coverage conflict when discovery refuses after seeding pending", async () => {
		const db = await freshDb();
		const bootstrapped = await bootstrapFromIdentity(db, knownIdentity);
		if (bootstrapped.kind !== "bootstrapped") {
			throw new Error(`expected bootstrapped, got ${bootstrapped.kind}`);
		}

		const result = await runSingleTargetPublish(db, {
			anchor: knownMal,
			budget: 0,
			clients: { discovery: publishClients() },
			group: bootstrapped.group,
			targetService: "anilist",
		});

		expect(result).toEqual({
			kind: "refused",
			reason: "over-budget",
		});
		expect(
			await coverageStateFor(
				db,
				groupCoverageKey(bootstrapped.group.groupId),
				1,
				"anilist",
			),
		).toBe("conflict");
	});
});

describe("fetchTargetStream", () => {
	it("treats non-enumerable services as unavailable", async () => {
		const { NotEnumerableServiceError } = await import("./not-enumerable.ts");
		const outcome = await fetchTargetStream({
			clients: {
				externalIds: {
					describe: async () => {
						await Promise.resolve();
						return { externalIds: [], firstAirDate: undefined };
					},
				},
				find: {
					find: async () => {
						await Promise.resolve();
						return [];
					},
				},
				instalments: {
					enumerate: async (title) => {
						await Promise.resolve();
						throw new NotEnumerableServiceError(title.service);
					},
				},
			},
			target: { service: "tmdb", serviceId: "123" },
		});

		expect(outcome).toEqual({ kind: "unavailable", reason: "not-enumerable" });
	});
});
