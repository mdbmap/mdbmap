import { and, eq } from "drizzle-orm";
import type { Promisable } from "type-fest";

import { one } from "@/db";
import type { Db } from "@/db";
import type { CandidateEvidence, CandidateSubject } from "@/db/engine-schema";
import {
	candidateSubjectKey,
	contentUnits,
	instalmentAssertions,
	pendingGroupCandidates,
	relationAssertions,
	serviceInstalments,
	titleAssertions,
} from "@/db/engine-schema";
import type { ReviewProposal } from "@/engine/reviewer";

import { corroborate } from "./corroboration.ts";
import type {
	CorroborationDecision,
	CorroborationEvidence,
} from "./corroboration.ts";
import { findTitle } from "./persist.ts";
import type { ServiceRef } from "./persist.ts";

const RESEARCH = "llm-research" as const;
const ROW_MISSING = "research publish: expected an inserted row";

interface TitleProposal {
	readonly claim: string;
	readonly evidence: readonly CorroborationEvidence[];
	readonly kind: "title";
	readonly left: ServiceRef;
	readonly right: ServiceRef;
}

interface RelationProposal {
	readonly claim: string;
	readonly evidence: readonly CorroborationEvidence[];
	readonly from: ServiceRef;
	readonly kind: "relation";
	readonly to: ServiceRef;
}

interface InstalmentProposal {
	readonly claim: string;
	readonly evidence: readonly CorroborationEvidence[];
	readonly instalmentId: number;
	readonly kind: "instalment";
	readonly unitId?: string;
}

type ResearchProposal =
	| InstalmentProposal
	| RelationProposal
	| TitleProposal;

interface PublishedResearch {
	readonly assertionId: number;
	readonly confidence: "high" | "low";
	readonly review: ReviewProposal;
	readonly reviewFlag: "low-confidence-flag" | undefined;
}

type ReviewEnqueue = (proposal: ReviewProposal) => Promisable<unknown>;

const ascendingPair = (
	left: number,
	right: number,
): readonly [number, number] =>
	left < right ? [left, right] : [right, left];

const requireTitleId = async (db: Db, ref: ServiceRef): Promise<number> => {
	const id = await findTitle(db, ref);
	if (id === undefined) {
		throw new Error(
			`research publish: missing spoke for ${ref.service}:${ref.serviceId}`,
		);
	}
	return id;
};

const capturedFrom = (
	evidence: readonly CorroborationEvidence[],
): ReviewProposal["evidence"] =>
	evidence
		.filter((item) => item.kind === "api" || item.kind === "scrape")
		.map((item) => ({
			kind: item.kind,
			operator: item.operator,
			summary: `${item.kind} evidence from ${item.operator} (${item.stance})`,
			url: item.url,
		}));

const publishedResult = (
	proposal: ResearchProposal,
	assertionId: number,
	decision: CorroborationDecision,
): PublishedResearch => ({
	assertionId,
	confidence: decision.confidence,
	review: {
		assertionId,
		claim: proposal.claim,
		evidence: capturedFrom(proposal.evidence),
		kind: proposal.kind,
	},
	reviewFlag: decision.reviewFlag,
});

const queueFlag = async (
	db: Db,
	input: {
		readonly evidence: CandidateEvidence;
		readonly evidenceHash: string;
		readonly subject: CandidateSubject;
	},
): Promise<void> => {
	await db
		.insert(pendingGroupCandidates)
		.values({
			evidence: input.evidence,
			evidenceHash: input.evidenceHash,
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
	const subject = {
		subjectType: "title" as const,
		titleId: input.titleId,
	};
	await queueFlag(db, {
		evidence: {
			confidence: input.assertionConfidence,
			instalmentId: input.instalmentId,
			kind: "low-confidence-flag",
			source: RESEARCH,
			target: "instalment",
			unitId: input.unitId,
		},
		evidenceHash: `low-confidence-flag:${input.instalmentId}:${input.unitId}`,
		subject,
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
	const subject = {
		subjectType: "title-pair" as const,
		titleAId: input.titleAId,
		titleBId: input.titleBId,
	};
	await queueFlag(db, {
		evidence: {
			confidence: input.assertionConfidence,
			kind: "low-confidence-flag",
			source: RESEARCH,
			target: "title",
			titleAId: input.titleAId,
			titleBId: input.titleBId,
		},
		evidenceHash: `low-confidence-flag:title:${input.titleAId}:${input.titleBId}`,
		subject,
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
	const subject = {
		subjectType: "title-pair" as const,
		titleAId: input.fromTitleId,
		titleBId: input.toTitleId,
	};
	await queueFlag(db, {
		evidence: {
			confidence: input.assertionConfidence,
			fromTitleId: input.fromTitleId,
			kind: "low-confidence-flag",
			source: RESEARCH,
			target: "relation",
			toTitleId: input.toTitleId,
		},
		evidenceHash: `low-confidence-flag:relation:${input.fromTitleId}:${input.toTitleId}`,
		subject,
	});
};

const publishTitleProposal = async (
	db: Db,
	proposal: TitleProposal,
): Promise<PublishedResearch> => {
	const decision = corroborate(proposal.evidence);
	const leftId = await requireTitleId(db, proposal.left);
	const rightId = await requireTitleId(db, proposal.right);
	const [titleAId, titleBId] = ascendingPair(leftId, rightId);
	const existing = await db
		.select({ id: titleAssertions.id })
		.from(titleAssertions)
		.where(
			and(
				eq(titleAssertions.titleAId, titleAId),
				eq(titleAssertions.titleBId, titleBId),
			),
		)
		.all();
	const assertionId =
		existing[0]?.id ??
		one(
			await db
				.insert(titleAssertions)
				.values({
					confidence: decision.confidence,
					source: RESEARCH,
					titleAId,
					titleBId,
				})
				.returning()
				.all(),
			ROW_MISSING,
		).id;

	if (decision.reviewFlag !== undefined) {
		await queueTitlePairFlag(db, {
			assertionConfidence: decision.confidence,
			titleAId,
			titleBId,
		});
	}

	return publishedResult(proposal, assertionId, decision);
};

const publishRelationProposal = async (
	db: Db,
	proposal: RelationProposal,
): Promise<PublishedResearch> => {
	const decision = corroborate(proposal.evidence);
	const fromTitleId = await requireTitleId(db, proposal.from);
	const toTitleId = await requireTitleId(db, proposal.to);
	const assertionId = one(
		await db
			.insert(relationAssertions)
			.values({
				confidence: decision.confidence,
				fromTitleId,
				source: RESEARCH,
				toTitleId,
			})
			.returning()
			.all(),
		ROW_MISSING,
	).id;

	if (decision.reviewFlag !== undefined) {
		await queueRelationFlag(db, {
			assertionConfidence: decision.confidence,
			fromTitleId,
			toTitleId,
		});
	}

	return publishedResult(proposal, assertionId, decision);
};

const publishInstalmentProposal = async (
	db: Db,
	proposal: InstalmentProposal,
): Promise<PublishedResearch> => {
	const decision = corroborate(proposal.evidence);
	const unitId =
		proposal.unitId ??
		one(
			await db.insert(contentUnits).values({}).returning().all(),
			ROW_MISSING,
		).id;
	const assertionId = one(
		await db
			.insert(instalmentAssertions)
			.values({
				confidence: decision.confidence,
				instalmentId: proposal.instalmentId,
				source: RESEARCH,
				unitId,
			})
			.returning()
			.all(),
		ROW_MISSING,
	).id;

	if (decision.reviewFlag !== undefined) {
		const spoke = one(
			await db
				.select({ titleId: serviceInstalments.titleId })
				.from(serviceInstalments)
				.where(eq(serviceInstalments.id, proposal.instalmentId))
				.all(),
			ROW_MISSING,
		);
		await queueInstalmentFlag(db, {
			assertionConfidence: decision.confidence,
			instalmentId: proposal.instalmentId,
			titleId: spoke.titleId,
			unitId,
		});
	}

	return publishedResult(proposal, assertionId, decision);
};

const publishProposal = async (
	db: Db,
	proposal: ResearchProposal,
): Promise<PublishedResearch> => {
	switch (proposal.kind) {
		case "title": {
			return publishTitleProposal(db, proposal);
		}
		case "relation": {
			return publishRelationProposal(db, proposal);
		}
		case "instalment": {
			return publishInstalmentProposal(db, proposal);
		}
	}
};

const publishRemaining = async (
	db: Db,
	remaining: readonly ResearchProposal[],
	enqueueReview: ReviewEnqueue,
	done: readonly PublishedResearch[],
): Promise<readonly PublishedResearch[]> => {
	const [head, ...tail] = remaining;
	if (head === undefined) {
		return done;
	}
	const result = await publishProposal(db, head);
	await enqueueReview(result.review);
	return publishRemaining(db, tail, enqueueReview, [...done, result]);
};

// Corroborate, persist as `llm-research`, then hand each proposal to the
// existing reviewer (issue #61) for promotion. The gate never skips.
const publishResearchProposals = async (
	db: Db,
	proposals: readonly ResearchProposal[],
	enqueueReview: ReviewEnqueue,
): Promise<readonly PublishedResearch[]> =>
	publishRemaining(db, proposals, enqueueReview, []);

export { publishResearchProposals };
export type {
	InstalmentProposal,
	PublishedResearch,
	RelationProposal,
	ResearchProposal,
	ReviewEnqueue,
	TitleProposal,
};
