import { describe, expect, it } from "vitest";

import { freshDb } from "@/db/test-helpers";
import type { SimklClient } from "@/engine/discovery";
import type { DiscoveryClients } from "@/engine/discovery/structural.ts";

import { estimateIngestWork } from "./cold-lookup.ts";
import type { IngestEnv } from "./env.ts";

const brokeredSimkl = (): SimklClient => ({
	fetchEntry: (id) => ({
		externalIds:
			id === "2"
				? { anilist: "20", mal: "200" }
				: { anilist: "10", mal: "100" },
		id,
		relations: id === "1" ? [{ kind: "sequel", toId: "2" }] : [],
		title: id,
		type: "anime",
	}),
	findByExternalId: () => ({
		externalIds: { anilist: "10", mal: "100" },
		id: "1",
		relations: [],
		title: "one",
		type: "anime",
	}),
});

const unusedDiscovery = (): DiscoveryClients => ({
	externalIds: {
		describe: () => {
			throw new Error("brokered estimate must not use direct discovery");
		},
	},
	find: {
		find: () => {
			throw new Error("brokered estimate must not use direct discovery");
		},
	},
	instalments: {
		enumerate: () => {
			throw new Error("estimate must not enumerate instalments");
		},
	},
});

describe("estimateIngestWork", () => {
	it("uses a brokered continuity walk to size production ingest work", async () => {
		const ingest: IngestEnv = {
			catalogue: { simkl: brokeredSimkl(), verification: {} },
			db: await freshDb(),
			dispatcher: undefined,
			structuralDiscovery: unusedDiscovery(),
		};

		const estimate = await estimateIngestWork({
			group: {
				baselineContinuity: "group:42",
				continuityId: 42,
				groupId: 42,
				requestedTitleId: 1,
			},
			ingest,
			targetService: "mal",
			title: { id: "10", service: "anilist" },
		});

		expect(estimate.input).toEqual({
			chainSegments: 2,
			targetCandidates: 2,
			targetServices: 1,
		});
		expect(estimate.builds).toEqual([
			{
				baselineRevision: 1,
				continuity: "group:42",
				targetService: "mal",
			},
		]);
	});
});
