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

// ADR-0002 provenance: manual > community > llm-verified > llm-research > tiers.
const outranksResearch = (source: AssertionSource): boolean =>
	source === "manual" ||
	source === "community" ||
	source === "llm-verified";

interface ExistingAssertion {
	readonly confidence: "high" | "low";
	readonly id: number;
	readonly source: AssertionSource;
}

interface InsertOrLoadResult {
	readonly assertionId: number;
	readonly existing: ExistingAssertion | undefined;
}

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

const insertOrLoadAssertion = async (input: {
	readonly insert: () => Promise<number>;
	readonly load: () => Promise<ExistingAssertion | undefined>;
}): Promise<InsertOrLoadResult> => {
	const loaded = await input.load();
	if (loaded !== undefined) {
		return { assertionId: loaded.id, existing: loaded };
	}
	try {
		return { assertionId: await input.insert(), existing: undefined };
	} catch (error) {
		if (!isUniqueViolation(error)) {
			throw error;
		}
		const raced = await input.load();
		if (raced === undefined) {
			throw error;
		}
		return { assertionId: raced.id, existing: raced };
	}
};

const syncResearchOwned = async (input: {
	readonly decision: CorroborationDecision;
	readonly existing: ExistingAssertion | undefined;
	readonly queueFlag: () => Promise<void>;
	readonly updateConfidence: (assertionId: number) => Promise<void>;
}): Promise<void> => {
	const owns =
		input.existing === undefined || !outranksResearch(input.existing.source);
	if (
		input.existing !== undefined &&
		owns &&
		input.existing.confidence !== input.decision.confidence
	) {
		await input.updateConfidence(input.existing.id);
	}
	if (input.decision.reviewFlag !== undefined && owns) {
		await input.queueFlag();
	}
};

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

const loadTitleAssertion = async (
	db: Db,
	titleAId: number,
	titleBId: number,
): Promise<ExistingAssertion | undefined> => {
	const existing = await db
		.select({
			confidence: titleAssertions.confidence,
			id: titleAssertions.id,
			source: titleAssertions.source,
		})
		.from(titleAssertions)
		.where(
			and(
				eq(titleAssertions.titleAId, titleAId),
				eq(titleAssertions.titleBId, titleBId),
			),
		)
		.all();
	return existing[0];
};

const insertTitleAssertion = async (
	db: Db,
	input: {
		readonly confidence: "high" | "low";
		readonly titleAId: number;
		readonly titleBId: number;
	},
): Promise<number> =>
	one(
		await db
			.insert(titleAssertions)
			.values({
				confidence: input.confidence,
				source: RESEARCH,
				titleAId: input.titleAId,
				titleBId: input.titleBId,
			})
			.returning()
			.all(),
		ROW_MISSING,
	).id;

const publishTitleProposal = async (
	db: Db,
	proposal: TitleProposal,
): Promise<PublishedResearch | undefined> => {
	const decision = corroborate(proposal.evidence);
	const leftId = await requireTitleId(db, proposal.left);
	const rightId = await requireTitleId(db, proposal.right);
	const [titleAId, titleBId] = ascendingPair(leftId, rightId);
	const { assertionId, existing } = await insertOrLoadAssertion({
		insert: async () =>
			insertTitleAssertion(db, {
				confidence: decision.confidence,
				titleAId,
				titleBId,
			}),
		load: async () => loadTitleAssertion(db, titleAId, titleBId),
	});
	if (existing !== undefined && outranksResearch(existing.source)) {
		return undefined;
	}
	await syncResearchOwned({
		decision,
		existing,
		queueFlag: async () =>
			queueTitlePairFlag(db, {
				assertionConfidence: decision.confidence,
				titleAId,
				titleBId,
			}),
		updateConfidence: async (id) => {
			await db
				.update(titleAssertions)
				.set({ confidence: decision.confidence })
				.where(eq(titleAssertions.id, id))
				.run();
		},
	});
	return publishedResult(proposal, assertionId, decision);
};

const existingRelationAssertion = async (
	db: Db,
	fromTitleId: number,
	toTitleId: number,
): Promise<ExistingAssertion | undefined> => {
	const existing = await db
		.select({
			confidence: relationAssertions.confidence,
			id: relationAssertions.id,
			source: relationAssertions.source,
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
> => {
	const byEndpoint = await db
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
	const reverse = await db
		.select({
			fromTitleId: relationAssertions.fromTitleId,
			id: relationAssertions.id,
			source: relationAssertions.source,
			toTitleId: relationAssertions.toTitleId,
		})
		.from(relationAssertions)
		.where(
			and(
				eq(relationAssertions.fromTitleId, toTitleId),
				eq(relationAssertions.toTitleId, fromTitleId),
			),
		)
		.all();
	if (reverse.length === 0) {
		return byEndpoint;
	}
	const seen = new Set(byEndpoint.map((row) => row.id));
	return [
		...byEndpoint,
		...reverse.filter((row) => !seen.has(row.id)),
	];
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
	const manualBlocks = input.published.some((row) => row.source === "manual");
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
			...(manualBlocks ? { status: "rejected" as const } : {}),
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

const applyOwnedRelation = async (
	db: Db,
	input: {
		readonly decision: CorroborationDecision;
		readonly existing: ExistingAssertion;
		readonly fromTitleId: number;
		readonly toTitleId: number;
	},
): Promise<void> => {
	await syncResearchOwned({
		decision: input.decision,
		existing: input.existing,
		queueFlag: async () =>
			queueRelationFlag(db, {
				assertionConfidence: input.decision.confidence,
				fromTitleId: input.fromTitleId,
				toTitleId: input.toTitleId,
			}),
		updateConfidence: async (id) => {
			await db
				.update(relationAssertions)
				.set({ confidence: input.decision.confidence })
				.where(eq(relationAssertions.id, id))
				.run();
		},
	});
};

const publishRelationProposal = async (
	db: Db,
	proposal: RelationProposal,
): Promise<PublishedResearch | undefined> => {
	const decision = corroborate(proposal.evidence);
	const fromTitleId = await requireTitleId(db, proposal.from);
	const toTitleId = await requireTitleId(db, proposal.to);
	const exact = await existingRelationAssertion(db, fromTitleId, toTitleId);
	if (exact !== undefined) {
		if (outranksResearch(exact.source)) {
			return undefined;
		}
		await applyOwnedRelation(db, {
			decision,
			existing: exact,
			fromTitleId,
			toTitleId,
		});
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
		const racedExact = await existingRelationAssertion(
			db,
			fromTitleId,
			toTitleId,
		);
		if (racedExact !== undefined) {
			if (outranksResearch(racedExact.source)) {
				return undefined;
			}
			await applyOwnedRelation(db, {
				decision,
				existing: racedExact,
				fromTitleId,
				toTitleId,
			});
			return publishedResult(proposal, racedExact.id, decision);
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

const spokeTitleId = async (
	db: Db,
	instalmentId: number,
): Promise<number> =>
	one(
		await db
			.select({ titleId: serviceInstalments.titleId })
			.from(serviceInstalments)
			.where(eq(serviceInstalments.id, instalmentId))
			.all(),
		ROW_MISSING,
	).titleId;

const queueInstalmentCoverageConflict = async (
	db: Db,
	input: {
		readonly decision: CorroborationDecision;
		readonly instalmentId: number;
		readonly published: {
			readonly confidence: "high" | "low";
			readonly source: AssertionSource;
			readonly unitId: string;
		};
		readonly unitId: string;
	},
): Promise<void> => {
	const titleId = await spokeTitleId(db, input.instalmentId);
	const subject: CandidateSubject = { subjectType: "title", titleId };
	const evidence: CandidateEvidence = {
		instalmentId: input.instalmentId,
		kind: "instalment-assertion-conflict",
		proposed: {
			confidence: input.decision.confidence,
			source: RESEARCH,
			unitId: input.unitId,
		},
		published: {
			confidence: input.published.confidence,
			source: input.published.source,
			unitId: input.published.unitId,
		},
	};
	const evidenceHash = `instalment-assertion-conflict:${input.instalmentId}:${input.unitId}`;
	await db
		.insert(pendingGroupCandidates)
		.values({
			evidence,
			evidenceHash,
			kind: "instalment-assertion-conflict",
			...(input.published.source === "manual"
				? { status: "rejected" as const }
				: {}),
			subject,
			subjectKey: candidateSubjectKey(subject),
		})
		.onConflictDoNothing()
		.run();
};

const resolveInstalmentUnitId = async (
	db: Db,
	proposal: InstalmentProposal,
): Promise<string> => {
	if (proposal.unitId !== undefined) {
		return proposal.unitId;
	}
	const priorResearch = await db
		.select({ unitId: instalmentAssertions.unitId })
		.from(instalmentAssertions)
		.where(
			and(
				eq(instalmentAssertions.instalmentId, proposal.instalmentId),
				eq(instalmentAssertions.source, RESEARCH),
			),
		)
		.all();
	if (priorResearch[0] !== undefined) {
		return priorResearch[0].unitId;
	}
	// Reuse any existing spoke coverage so higher-precedence rows are seen
	// by the outranksResearch gate instead of minting a competing unit.
	const priorAny = await db
		.select({ unitId: instalmentAssertions.unitId })
		.from(instalmentAssertions)
		.where(eq(instalmentAssertions.instalmentId, proposal.instalmentId))
		.all();
	if (priorAny[0] !== undefined) {
		return priorAny[0].unitId;
	}
	return one(
		await db.insert(contentUnits).values({}).returning().all(),
		ROW_MISSING,
	).id;
};

const competingSpokeCoverage = async (
	db: Db,
	instalmentId: number,
	unitId: string,
): Promise<
	| {
			readonly confidence: "high" | "low";
			readonly source: AssertionSource;
			readonly unitId: string;
	  }
	| undefined
> => {
	const rows = await db
		.select({
			confidence: instalmentAssertions.confidence,
			source: instalmentAssertions.source,
			unitId: instalmentAssertions.unitId,
		})
		.from(instalmentAssertions)
		.where(eq(instalmentAssertions.instalmentId, instalmentId))
		.all();
	return rows.find((row) => row.unitId !== unitId);
};

const existingInstalmentAssertion = async (
	db: Db,
	instalmentId: number,
	unitId: string,
): Promise<ExistingAssertion | undefined> => {
	const existing = await db
		.select({
			confidence: instalmentAssertions.confidence,
			id: instalmentAssertions.id,
			source: instalmentAssertions.source,
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
): Promise<PublishedResearch | undefined> => {
	const decision = corroborate(proposal.evidence);
	const unitId = await resolveInstalmentUnitId(db, proposal);
	const competing = await competingSpokeCoverage(
		db,
		proposal.instalmentId,
		unitId,
	);
	if (competing !== undefined) {
		await queueInstalmentCoverageConflict(db, {
			decision,
			instalmentId: proposal.instalmentId,
			published: competing,
			unitId,
		});
		return undefined;
	}
	const { assertionId, existing } = await insertOrLoadAssertion({
		insert: async () =>
			insertInstalmentAssertion(db, {
				confidence: decision.confidence,
				instalmentId: proposal.instalmentId,
				unitId,
			}),
		load: async () =>
			existingInstalmentAssertion(db, proposal.instalmentId, unitId),
	});
	if (existing !== undefined && outranksResearch(existing.source)) {
		return undefined;
	}
	await syncResearchOwned({
		decision,
		existing,
		queueFlag: async () => {
			const titleId = await spokeTitleId(db, proposal.instalmentId);
			await queueInstalmentFlag(db, {
				assertionConfidence: decision.confidence,
				instalmentId: proposal.instalmentId,
				titleId,
				unitId,
			});
		},
		updateConfidence: async (id) => {
			await db
				.update(instalmentAssertions)
				.set({ confidence: decision.confidence })
				.where(eq(instalmentAssertions.id, id))
				.run();
		},
	});
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
