import { eq } from "drizzle-orm";

import type { Db } from "@/db";
import {
	candidateSubjectKey,
	instalmentAssertions,
	pendingGroupCandidates,
} from "@/db/engine-schema";
import type {
	AssertionSource,
	CandidateEvidence,
	CandidateSubject,
} from "@/db/engine-schema";
import type { InstalmentLocator } from "@/db/schema";
import type { Crossing } from "@/engine/matcher";

import { spokeIdFor } from "./spokes.ts";

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
): Promise<void> => {
	const { earlier, later, side } = input.crossing;
	const titleId = side === "left" ? input.anchorTitleId : input.targetTitleId;
	const earlierLocators = side === "left" ? earlier.left : earlier.right;
	const laterLocators = side === "left" ? later.left : later.right;
	const laterTargetLocators = side === "left" ? later.right : later.left;

	const earlierSpokeId = await spokeIdFor(db, titleId, earlierLocators[0]);
	const laterSpokeId = await spokeIdFor(db, titleId, laterLocators[0]);
	if (earlierSpokeId === undefined || laterSpokeId === undefined) {
		return;
	}

	const primaryInstalmentId = laterSpokeId;
	const publishedRow = await db
		.select()
		.from(instalmentAssertions)
		.where(eq(instalmentAssertions.instalmentId, earlierSpokeId))
		.get();
	if (publishedRow === undefined) {
		return;
	}
	const subject: CandidateSubject = {
		instalmentAId: earlierSpokeId,
		instalmentBId: laterSpokeId,
		subjectType: "instalment-pair",
	};
	const proposedUnitId = proposedUnitIdFor(laterLocators, laterTargetLocators);
	const evidence: CandidateEvidence = {
		instalmentId: primaryInstalmentId,
		kind: "instalment-assertion-conflict",
		proposed: {
			confidence: "high",
			source: input.triedSource,
			unitId: proposedUnitId,
		},
		published: {
			confidence: publishedRow.confidence,
			source: publishedRow.source,
			unitId: publishedRow.unitId,
		},
	};
	const evidenceHash = `${input.evidenceHashPrefix}:instalment-assertion-conflict:${primaryInstalmentId}:${proposedUnitId}`;
	await db
		.insert(pendingGroupCandidates)
		.values({
			evidence,
			evidenceHash,
			kind: "instalment-assertion-conflict",
			subject,
			subjectKey: candidateSubjectKey(subject),
		})
		.onConflictDoNothing()
		.run();
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
): Promise<void> => {
	await Promise.all(
		input.crossings.map(async (crossing) =>
			queueCrossingConflict(db, { ...input, crossing }),
		),
	);
};

export { queueAlignmentCrossingConflicts };
