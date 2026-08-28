import { describe, expect, it } from "vitest";

import { pendingGroupCandidates, serviceInstalments } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import type { Crossing } from "@/engine/matcher";
import { locator, regular, streamOf } from "@/engine/matcher/test-fixtures.ts";

import { queueAlignmentCrossingConflicts } from "./alignment-conflict.ts";
import { bootstrapFromIdentity } from "./bootstrap.ts";
import { ensureSpokes, ensureTitle } from "./spokes.ts";

const knownMal = { id: "50265", service: "mal" as const };
const knownIdentity = { kind: "title" as const, title: knownMal };

const crossing: Crossing = {
	earlier: {
		left: [locator("s1e1")],
		right: [locator("s1e1")],
	},
	later: {
		left: [locator("s1e2")],
		right: [locator("s1e1")],
	},
	side: "left",
};

describe("queueAlignmentCrossingConflicts", () => {
	it("queues instalment-assertion-conflict rows for crossings", async () => {
		const db = await freshDb();
		const bootstrapped = await bootstrapFromIdentity(db, knownIdentity);
		if (bootstrapped.kind !== "bootstrapped") {
			throw new Error(`expected bootstrapped, got ${bootstrapped.kind}`);
		}
		const anchorTitleId = bootstrapped.group.requestedTitleId;
		const resolvedTargetTitleId = await ensureTitle(
			db,
			bootstrapped.group.groupId,
			{ service: "anilist", serviceId: "140960" },
			1,
		);
		await ensureSpokes(db, anchorTitleId, {
			facts: new Map(),
			stream: streamOf([regular("s1e1"), regular("s1e2")]),
		});
		await ensureSpokes(db, resolvedTargetTitleId, {
			facts: new Map(),
			stream: streamOf([regular("s1e1")]),
		});

		await queueAlignmentCrossingConflicts(db, {
			anchorTitleId,
			crossings: [crossing],
			evidenceHashPrefix: "test-alignment-conflict",
			targetTitleId: resolvedTargetTitleId,
			triedSource: "t3-episode",
		});

		const rows = await db.select().from(pendingGroupCandidates).all();
		const conflicts = rows.filter(
			(row) => row.kind === "instalment-assertion-conflict",
		);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]).toMatchObject({
			kind: "instalment-assertion-conflict",
			subject: {
				subjectType: "instalment-pair",
			},
		});
		const spokes = await db.select().from(serviceInstalments).all();
		const s1e1 = spokes.find(
			(row) => row.locator === "s1e1" && row.titleId === anchorTitleId,
		);
		const s1e2 = spokes.find(
			(row) => row.locator === "s1e2" && row.titleId === anchorTitleId,
		);
		expect(conflicts[0]?.evidence).toMatchObject({
			instalmentId: s1e2?.id,
			kind: "instalment-assertion-conflict",
			proposed: {
				source: "t3-episode",
				unitId: "alignment:s1e1|s1e2",
			},
		});
		expect(conflicts[0]?.subject).toMatchObject({
			instalmentAId: s1e1?.id,
			instalmentBId: s1e2?.id,
		});
	});
});
