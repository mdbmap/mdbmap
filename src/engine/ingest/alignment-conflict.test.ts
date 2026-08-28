import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
	contentUnits,
	instalmentAssertions,
	pendingGroupCandidates,
	serviceInstalments,
} from "@/db/engine-schema";
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
		const targetTitleId = await ensureTitle(
			db,
			bootstrapped.group.groupId,
			{ service: "anilist", serviceId: "140960" },
			1,
		);
		await ensureSpokes(db, anchorTitleId, {
			facts: new Map(),
			stream: streamOf([regular("s1e1"), regular("s1e2")]),
		});
		await ensureSpokes(db, targetTitleId, {
			facts: new Map(),
			stream: streamOf([regular("s1e1")]),
		});

		await queueAlignmentCrossingConflicts(db, {
			anchorTitleId,
			crossings: [crossing],
			evidenceHashPrefix: "test-alignment-conflict",
			targetTitleId,
			triedSource: "t3-episode",
		});

		const rows = await db.select().from(pendingGroupCandidates).all();
		const conflicts = rows.filter(
			(row) => row.kind === "instalment-assertion-conflict",
		);
		expect(conflicts).toHaveLength(1);
		const spokes = await db.select().from(serviceInstalments).all();
		const s1e2 = spokes.find(
			(row) => row.locator === "s1e2" && row.titleId === anchorTitleId,
		);
		const evidence = conflicts[0]?.evidence;
		expect(evidence).toMatchObject({
			instalmentId: s1e2?.id,
			kind: "instalment-assertion-conflict",
			proposed: {
				source: "t3-episode",
			},
			published: {
				source: "bootstrap",
			},
		});
		if (evidence?.kind !== "instalment-assertion-conflict") {
			throw new Error("expected instalment-assertion-conflict evidence");
		}
		const units = await db.select().from(contentUnits).all();
		expect(units.map((row) => row.id)).toContain(evidence.proposed.unitId);
	});

	it("queues with published null when the earlier spoke has no assertion", async () => {
		const db = await freshDb();
		const bootstrapped = await bootstrapFromIdentity(db, {
			kind: "title",
			title: { id: "99999", service: "mal" },
		});
		if (bootstrapped.kind !== "bootstrapped") {
			throw new Error(`expected bootstrapped, got ${bootstrapped.kind}`);
		}
		const anchorTitleId = bootstrapped.group.requestedTitleId;
		const targetTitleId = await ensureTitle(
			db,
			bootstrapped.group.groupId,
			{ service: "anilist", serviceId: "99999" },
			1,
		);
		await ensureSpokes(db, anchorTitleId, {
			facts: new Map(),
			stream: streamOf([regular("s1e1"), regular("s1e2")]),
		});
		const spokes = await db.select().from(serviceInstalments).all();
		const s1e1Spoke = spokes.find(
			(row) => row.locator === "s1e1" && row.titleId === anchorTitleId,
		);
		if (s1e1Spoke !== undefined) {
			await db
				.delete(instalmentAssertions)
				.where(eq(instalmentAssertions.instalmentId, s1e1Spoke.id))
				.run();
		}
		await ensureSpokes(db, targetTitleId, {
			facts: new Map(),
			stream: streamOf([regular("s1e1")]),
		});

		await queueAlignmentCrossingConflicts(db, {
			anchorTitleId,
			crossings: [crossing],
			evidenceHashPrefix: "test-null-published",
			targetTitleId,
			triedSource: "t3-episode",
		});

		const rows = await db.select().from(pendingGroupCandidates).all();
		const conflicts = rows.filter(
			(row) => row.kind === "instalment-assertion-conflict",
		);
		expect(conflicts).toHaveLength(1);
		const evidence = conflicts[0]?.evidence;
		expect(evidence?.kind).toBe("instalment-assertion-conflict");
		if (evidence?.kind === "instalment-assertion-conflict") {
			expect(evidence.published).toBeNull();
		}
	});
});
