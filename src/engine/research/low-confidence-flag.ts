import { ascendingPair } from "@/db";
import type { Db } from "@/db";
import type { CandidateEvidence, CandidateSubject } from "@/db/engine-schema";
import {
	candidateSubjectKey,
	pendingGroupCandidates,
} from "@/db/engine-schema";

import { RESEARCH } from "./assertions.ts";

type LowConfidenceEvidence = Extract<
	CandidateEvidence,
	{ kind: "low-confidence-flag" }
>;

const flagEvidenceHash = (evidence: LowConfidenceEvidence): string => {
	switch (evidence.target) {
		case "instalment": {
			return `low-confidence-flag:${evidence.instalmentId}:${evidence.unitId}`;
		}
		case "title": {
			const [titleAId, titleBId] = ascendingPair(
				evidence.titleAId,
				evidence.titleBId,
			);
			return `low-confidence-flag:title:${titleAId}:${titleBId}`;
		}
		case "relation": {
			return `low-confidence-flag:relation:${evidence.fromTitleId}->${evidence.toTitleId}`;
		}
	}
};

const queueFlag = async (
	db: Db,
	input: {
		readonly evidence: LowConfidenceEvidence;
		readonly subject: CandidateSubject;
	},
): Promise<void> => {
	await db
		.insert(pendingGroupCandidates)
		.values({
			evidence: input.evidence,
			evidenceHash: flagEvidenceHash(input.evidence),
			kind: "low-confidence-flag",
			subject: input.subject,
			subjectKey: candidateSubjectKey(input.subject),
		})
		.onConflictDoNothing()
		.run();
};

const queueInstalmentFlag = async (
	db: Db,
	input: {
		readonly assertionConfidence: "high" | "low";
		readonly instalmentId: number;
		readonly titleId: number;
		readonly unitId: string;
	},
): Promise<void> => {
	await queueFlag(db, {
		evidence: {
			confidence: input.assertionConfidence,
			instalmentId: input.instalmentId,
			kind: "low-confidence-flag",
			source: RESEARCH,
			target: "instalment",
			unitId: input.unitId,
		},
		subject: {
			subjectType: "title",
			titleId: input.titleId,
		},
	});
};

const queueTitlePairFlag = async (
	db: Db,
	input: {
		readonly assertionConfidence: "high" | "low";
		readonly titleAId: number;
		readonly titleBId: number;
	},
): Promise<void> => {
	const [titleAId, titleBId] = ascendingPair(input.titleAId, input.titleBId);
	await queueFlag(db, {
		evidence: {
			confidence: input.assertionConfidence,
			kind: "low-confidence-flag",
			source: RESEARCH,
			target: "title",
			titleAId,
			titleBId,
		},
		subject: {
			subjectType: "title-pair",
			titleAId,
			titleBId,
		},
	});
};

const queueRelationFlag = async (
	db: Db,
	input: {
		readonly assertionConfidence: "high" | "low";
		readonly fromTitleId: number;
		readonly toTitleId: number;
	},
): Promise<void> => {
	await queueFlag(db, {
		evidence: {
			confidence: input.assertionConfidence,
			fromTitleId: input.fromTitleId,
			kind: "low-confidence-flag",
			source: RESEARCH,
			target: "relation",
			toTitleId: input.toTitleId,
		},
		subject: {
			subjectType: "title-pair",
			titleAId: input.fromTitleId,
			titleBId: input.toTitleId,
		},
	});
};

export {
	flagEvidenceHash,
	queueFlag,
	queueInstalmentFlag,
	queueRelationFlag,
	queueTitlePairFlag,
};
