import { and, eq, or } from "drizzle-orm";
import type { Promisable } from "type-fest";

import { ascendingPair, one } from "@/db";
import type { Db } from "@/db";
import type {
	AssertionSource,
	CandidateEvidence,
	CandidateSubject,
} from "@/db/engine-schema";
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

type LowConfidenceEvidence = Extract<
	CandidateEvidence,
	{ kind: "low-confidence-flag" }
>;

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

const publishTitleProposal = async (
	db: Db,
	proposal: TitleProposal,
): Promise<PublishedResearch> => {
	const decision = corroborate(proposal.evidence);
	const leftId = await requireTitleId(db, proposal.left);
	const rightId = await requireTitleId(db, proposal.right);
	const [titleAId, titleBId] = ascendingPair(leftId, rightId);
	const existing = await db
		.select({
			confidence: titleAssertions.confidence,
			id: titleAssertions.id,
		})
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

	if (
		existing[0] !== undefined &&
		existing[0].confidence !== decision.confidence
	) {
		await db
			.update(titleAssertions)
			.set({ confidence: decision.confidence })
			.where(eq(titleAssertions.id, assertionId))
			.run();
	}

	if (decision.reviewFlag !== undefined) {
		await queueTitlePairFlag(db, {
			assertionConfidence: decision.confidence,
			titleAId,
			titleBId,
		});
	}

	return publishedResult(proposal, assertionId, decision);
};

const existingRelationAssertion = async (
	db: Db,
	fromTitleId: number,
	toTitleId: number,
): Promise<{ confidence: "high" | "low"; id: number } | undefined> => {
	const existing = await db
		.select({
			confidence: relationAssertions.confidence,
			id: relationAssertions.id,
		})
		.from(relationAssertions)
		.where(
			and(
				eq(relationAssertions.fromTitleId, fromTitleId),
				eq(relationAssertions.toTitleId, toTitleId),
			),
		)
		.all();
	return existing[0];
};

const endpointConflicts = async (
	db: Db,
	fromTitleId: number,
	toTitleId: number,
): Promise<
	readonly {
		readonly fromTitleId: number;
		readonly id: number;
		readonly source: AssertionSource;
		readonly toTitleId: number;
	}[]
> =>
	db
		.select({
			fromTitleId: relationAssertions.fromTitleId,
			id: relationAssertions.id,
			source: relationAssertions.source,
			toTitleId: relationAssertions.toTitleId,
		})
		.from(relationAssertions)
		.where(
			or(
				eq(relationAssertions.fromTitleId, fromTitleId),
				eq(relationAssertions.toTitleId, toTitleId),
			),
		)
		.all();

const isUniqueViolation = (error: unknown): boolean => {
	let current: unknown = error;
	while (current instanceof Error) {
		if (/unique/iu.test(current.message)) {
			return true;
		}
		current = current.cause;
	}
	return false;
};

const queueCompetingRelations = async (
	db: Db,
	input: {
		readonly fromTitleId: number;
		readonly published: readonly {
			readonly fromTitleId: number;
			readonly source: AssertionSource;
			readonly toTitleId: number;
		}[];
		readonly toTitleId: number;
	},
): Promise<void> => {
	const [titleAId, titleBId] = ascendingPair(
		input.fromTitleId,
		input.toTitleId,
	);
	const subject: CandidateSubject = {
		subjectType: "title-pair",
		titleAId,
		titleBId,
	};
	const entryId = `research:${input.fromTitleId}->${input.toTitleId}`;
	await db
		.insert(pendingGroupCandidates)
		.values({
			evidence: {
				competingRelations: [
					...input.published.map((row) => ({
						fromTitleId: row.fromTitleId,
						source: row.source,
						toTitleId: row.toTitleId,
					})),
					{
						fromTitleId: input.fromTitleId,
						source: RESEARCH,
						toTitleId: input.toTitleId,
					},
				],
				entryId,
				kind: "continuity-conflict",
			},
			evidenceHash: `continuity-conflict:${entryId}`,
			kind: "continuity-conflict",
			subject,
			subjectKey: candidateSubjectKey(subject),
		})
		.onConflictDoNothing()
		.run();
};

const insertRelationAssertion = async (
	db: Db,
	input: {
		readonly confidence: "high" | "low";
		readonly fromTitleId: number;
		readonly toTitleId: number;
	},
): Promise<number> =>
	one(
		await db
			.insert(relationAssertions)
			.values({
				confidence: input.confidence,
				fromTitleId: input.fromTitleId,
				source: RESEARCH,
				toTitleId: input.toTitleId,
			})
			.returning()
			.all(),
		ROW_MISSING,
	).id;

const publishRelationProposal = async (
	db: Db,
	proposal: RelationProposal,
): Promise<PublishedResearch | undefined> => {
	const decision = corroborate(proposal.evidence);
	const fromTitleId = await requireTitleId(db, proposal.from);
	const toTitleId = await requireTitleId(db, proposal.to);
	const exact = await existingRelationAssertion(db, fromTitleId, toTitleId);
	if (exact !== undefined) {
		if (exact.confidence !== decision.confidence) {
			await db
				.update(relationAssertions)
				.set({ confidence: decision.confidence })
				.where(eq(relationAssertions.id, exact.id))
				.run();
		}
		if (decision.reviewFlag !== undefined) {
			await queueRelationFlag(db, {
				assertionConfidence: decision.confidence,
				fromTitleId,
				toTitleId,
			});
		}
		return publishedResult(proposal, exact.id, decision);
	}

	const conflicts = await endpointConflicts(db, fromTitleId, toTitleId);
	if (conflicts.length > 0) {
		await queueCompetingRelations(db, {
			fromTitleId,
			published: conflicts,
			toTitleId,
		});
		return undefined;
	}

	let assertionId: number;
	try {
		assertionId = await insertRelationAssertion(db, {
			confidence: decision.confidence,
			fromTitleId,
			toTitleId,
		});
	} catch (error) {
		if (!isUniqueViolation(error)) {
			throw error;
		}
		const raced = await endpointConflicts(db, fromTitleId, toTitleId);
		await queueCompetingRelations(db, {
			fromTitleId,
			published: raced,
			toTitleId,
		});
		return undefined;
	}

	if (decision.reviewFlag !== undefined) {
		await queueRelationFlag(db, {
			assertionConfidence: decision.confidence,
			fromTitleId,
			toTitleId,
		});
	}

	return publishedResult(proposal, assertionId, decision);
};

const resolveInstalmentUnitId = async (
	db: Db,
	proposal: InstalmentProposal,
): Promise<string> => {
	if (proposal.unitId !== undefined) {
		return proposal.unitId;
	}
	return one(
		await db.insert(contentUnits).values({}).returning().all(),
		ROW_MISSING,
	).id;
};

const existingInstalmentAssertion = async (
	db: Db,
	instalmentId: number,
	unitId: string,
): Promise<{ confidence: "high" | "low"; id: number } | undefined> => {
	const existing = await db
		.select({
			confidence: instalmentAssertions.confidence,
			id: instalmentAssertions.id,
		})
		.from(instalmentAssertions)
		.where(
			and(
				eq(instalmentAssertions.instalmentId, instalmentId),
				eq(instalmentAssertions.unitId, unitId),
			),
		)
		.all();
	return existing[0];
};

const insertInstalmentAssertion = async (
	db: Db,
	input: {
		readonly confidence: "high" | "low";
		readonly instalmentId: number;
		readonly unitId: string;
	},
): Promise<number> =>
	one(
		await db
			.insert(instalmentAssertions)
			.values({
				confidence: input.confidence,
				instalmentId: input.instalmentId,
				source: RESEARCH,
				unitId: input.unitId,
			})
			.returning()
			.all(),
		ROW_MISSING,
	).id;

const publishInstalmentProposal = async (
	db: Db,
	proposal: InstalmentProposal,
): Promise<PublishedResearch> => {
	const decision = corroborate(proposal.evidence);
	const unitId = await resolveInstalmentUnitId(db, proposal);
	const existing = await existingInstalmentAssertion(
		db,
		proposal.instalmentId,
		unitId,
	);
	const assertionId =
		existing?.id ??
		(await insertInstalmentAssertion(db, {
			confidence: decision.confidence,
			instalmentId: proposal.instalmentId,
			unitId,
		}));

	if (existing !== undefined && existing.confidence !== decision.confidence) {
		await db
			.update(instalmentAssertions)
			.set({ confidence: decision.confidence })
			.where(eq(instalmentAssertions.id, assertionId))
			.run();
	}

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
): Promise<PublishedResearch | undefined> => {
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
	if (result === undefined) {
		return publishRemaining(db, tail, enqueueReview, done);
	}
	await enqueueReview(result.review);
	return publishRemaining(db, tail, enqueueReview, [...done, result]);
};

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
