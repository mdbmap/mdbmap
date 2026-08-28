import { describe, expect, it } from "vitest";

import { pendingGroupCandidates } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import type { DiscoveredGroup } from "@/engine/ingest/phases.ts";

import { queueStructuralAlignmentConflict } from "./alignment-conflict.ts";

const discovered: DiscoveredGroup = {
	anchorOrdinal: 0,
	mappings: [
		{
			member: { service: "anilist", serviceId: "140960" },
			ordinal: 1,
			pairs: [],
		},
	],
	shared: { service: "mal", serviceId: "50265" },
};

describe("queueStructuralAlignmentConflict", () => {
	it("inserts a structural pending group candidate", async () => {
		const db = await freshDb();

		await queueStructuralAlignmentConflict(db, {
			anchorTitleId: 1,
			discovered,
			evidenceHashPrefix: "test-alignment-conflict",
			groupId: 42,
		});

		const rows = await db.select().from(pendingGroupCandidates).all();
		expect(rows).toHaveLength(1);
		expect(rows[0]).toMatchObject({
			evidenceHash: "test-alignment-conflict:42:1:anilist:140960,mal:50265",
			kind: "structural",
		});
	});
});
