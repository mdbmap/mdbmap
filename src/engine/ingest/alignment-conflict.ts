import { eq } from "drizzle-orm";
import { z } from "zod";

import type { Db } from "@/db";
import {
	candidateSubjectKey,
	contentUnits,
	instalmentAssertions,
	pendingGroupCandidates,
} from "@/db/engine-schema";
import type {
	AssertionSource,
	CandidateEvidence,
	CandidateSubject,
} from "@/db/engine-schema";
import { one } from "@/db/one";
import type { InstalmentLocator } from "@/db/schema";
import type { Crossing } from "@/engine/matcher";

import { spokeIdFor } from "./spokes.ts";

interface InstalmentConflictSide {
	readonly confidence: "high" | "low";
	readonly source: AssertionSource;
	readonly unitId: string;
}

const proposedUnitIdFor = (
	left: readonly InstalmentLocator[],
	right: readonly InstalmentLocator[],
): string => {
	const digest = [...left, ...right].toSorted().join("|");
	return `alignment:${digest}`;
};

const queueCrossingConflict = async (
	db: Db,
	input: {
		readonly anchorTitleId: number;
		readonly crossing: Crossing;
		readonly evidenceHashPrefix: string;
		readonly targetTitleId: number;
		readonly triedSource: AssertionSource;
	},
): Promise<boolean> => {
	const { earlier, later, side } = input.crossing;
	const titleId = side === "left" ? input.anchorTitleId : input.targetTitleId;
	const counterpartTitleId =
		side === "left" ? input.targetTitleId : input.anchorTitleId;
	const earlierLocators = side === "left" ? earlier.left : earlier.right;
	const laterLocators = side === "left" ? later.left : later.right;
	const laterTargetLocators = side === "left" ? later.right : later.left;

	const earlierSpokeId = await spokeIdFor(db, titleId, earlierLocators[0]);
	const laterSpokeId = await spokeIdFor(db, titleId, laterLocators[0]);
	const counterpartSpokeId = await spokeIdFor(
		db,
		counterpartTitleId,
		laterTargetLocators[0],
	);
	if (
		earlierSpokeId === undefined ||
		laterSpokeId === undefined ||
		counterpartSpokeId === undefined
	) {
		return false;
	}

	const primaryInstalmentId = laterSpokeId;
	const publishedRow = await db
		.select()
		.from(instalmentAssertions)
		.where(eq(instalmentAssertions.instalmentId, earlierSpokeId))
		.get();
	const subject: CandidateSubject = {
		instalmentAId: earlierSpokeId,
		instalmentBId: laterSpokeId,
		subjectType: "instalment-pair",
	};
	const proposalDigest = proposedUnitIdFor(laterLocators, laterTargetLocators);
	const proposedUnitId = one(
		await db.insert(contentUnits).values({}).returning().all(),
	).id;
	const published: InstalmentConflictSide | null =
		publishedRow === undefined
			? z.null().parse(JSON.parse("null"))
			: {
					confidence: publishedRow.confidence,
					source: publishedRow.source,
					unitId: publishedRow.unitId,
				};
	const evidence: CandidateEvidence = {
		counterpartInstalmentId: counterpartSpokeId,
		instalmentId: primaryInstalmentId,
		kind: "instalment-assertion-conflict",
		proposed: {
			confidence: input.crossing.confidence,
			source: input.triedSource,
			unitId: proposedUnitId,
		},
		published,
	};
	const evidenceHash = `${input.evidenceHashPrefix}:instalment-assertion-conflict:${primaryInstalmentId}:${proposalDigest}`;
	const inserted = await db
		.insert(pendingGroupCandidates)
		.values({
			evidence,
			evidenceHash,
			kind: "instalment-assertion-conflict",
			subject,
			subjectKey: candidateSubjectKey(subject),
		})
		.onConflictDoNothing()
		.returning()
		.all();
	if (inserted.length === 0) {
		await db
			.delete(contentUnits)
			.where(eq(contentUnits.id, proposedUnitId))
			.run();
	}
	return true;
};

const queueAlignmentCrossingConflicts = async (
	db: Db,
	input: {
		readonly anchorTitleId: number;
		readonly crossings: readonly Crossing[];
		readonly evidenceHashPrefix: string;
		readonly targetTitleId: number;
		readonly triedSource: AssertionSource;
	},
): Promise<boolean> => {
	const queued = await Promise.all(
		input.crossings.map(async (crossing) =>
			queueCrossingConflict(db, { ...input, crossing }),
		),
	);
	return queued.some(Boolean);
};

export { queueAlignmentCrossingConflicts };
