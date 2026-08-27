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
	serviceTitles,
	titleAssertions,
} from "@/db/engine-schema";
import { upsertRelationContinuity } from "@/engine/continuity/persist";
import type { ReviewProposal } from "@/engine/reviewer";

import { RESEARCH } from "./assertions.ts";
import { corroborate } from "./corroboration.ts";
import type {
	CorroborationDecision,
	CorroborationEvidence,
} from "./corroboration.ts";
import {
	queueInstalmentFlag,
	queueRelationFlag,
	queueTitlePairFlag,
} from "./low-confidence-flag.ts";
import { findTitle } from "./persist.ts";
import type { ServiceRef } from "./persist.ts";

const ROW_MISSING = "research publish: expected an inserted row";

// ADR-0002 provenance: manual > community > llm-verified > llm-research > tiers.
const outranksResearch = (source: AssertionSource): boolean =>
	source === "manual" || source === "community" || source === "llm-verified";

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

type ResearchProposal = InstalmentProposal | RelationProposal | TitleProposal;

interface PublishedResearch {
	readonly assertionId: number;
	readonly confidence: "high" | "low";
	readonly review: ReviewProposal;
	readonly reviewFlag: "low-confidence-flag" | undefined;
}

type ReviewEnqueue = (proposal: ReviewProposal) => Promisable<unknown>;

const titleIdFor = async (
	db: Db,
	ref: ServiceRef,
): Promise<number | undefined> => findTitle(db, ref);

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
	const leftId = await titleIdFor(db, proposal.left);
	const rightId = await titleIdFor(db, proposal.right);
	if (leftId === undefined || rightId === undefined) {
		return undefined;
	}
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

const ensureRelationContinuity = async (
	db: Db,
	input: {
		readonly assertionId: number;
		readonly fromTitleId: number;
		readonly reviewFlag: "low-confidence-flag" | undefined;
		readonly source: AssertionSource;
		readonly toTitleId: number;
	},
): Promise<void> => {
	if (input.reviewFlag !== undefined) {
		return;
	}
	await upsertRelationContinuity(db, {
		fromTitleId: input.fromTitleId,
		relationAssertionId: input.assertionId,
		source: input.source,
		toTitleId: input.toTitleId,
	});
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
	return [...byEndpoint, ...reverse.filter((row) => !seen.has(row.id))];
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
	const fromTitleId = await titleIdFor(db, proposal.from);
	const toTitleId = await titleIdFor(db, proposal.to);
	if (fromTitleId === undefined || toTitleId === undefined) {
		return undefined;
	}
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
		await ensureRelationContinuity(db, {
			assertionId: exact.id,
			fromTitleId,
			reviewFlag: decision.reviewFlag,
			source: exact.source,
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
			await ensureRelationContinuity(db, {
				assertionId: racedExact.id,
				fromTitleId,
				reviewFlag: decision.reviewFlag,
				source: racedExact.source,
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
	await ensureRelationContinuity(db, {
		assertionId,
		fromTitleId,
		reviewFlag: decision.reviewFlag,
		source: RESEARCH,
		toTitleId,
	});

	return publishedResult(proposal, assertionId, decision);
};

const spokeTitleId = async (db: Db, instalmentId: number): Promise<number> =>
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

const servicesFromProposal = async (
	db: Db,
	proposal: ResearchProposal,
): Promise<readonly string[]> => {
	switch (proposal.kind) {
		case "title": {
			return [proposal.left.service, proposal.right.service];
		}
		case "relation": {
			return [proposal.from.service, proposal.to.service];
		}
		case "instalment": {
			const owner = await db
				.select({ service: serviceTitles.service })
				.from(serviceInstalments)
				.innerJoin(
					serviceTitles,
					eq(serviceInstalments.titleId, serviceTitles.id),
				)
				.where(eq(serviceInstalments.id, proposal.instalmentId))
				.all();
			return owner[0] === undefined ? [] : [owner[0].service];
		}
	}
};

const publishRemaining = async (
	db: Db,
	remaining: readonly ResearchProposal[],
	enqueueReview: ReviewEnqueue,
	done: readonly PublishedResearch[],
	resolvedServices: Set<string>,
): Promise<readonly PublishedResearch[]> => {
	const [head, ...tail] = remaining;
	if (head === undefined) {
		return done;
	}
	const result = await publishProposal(db, head);
	if (result === undefined) {
		return publishRemaining(db, tail, enqueueReview, done, resolvedServices);
	}
	for (const service of await servicesFromProposal(db, head)) {
		resolvedServices.add(service);
	}
	await enqueueReview(result.review);
	return publishRemaining(
		db,
		tail,
		enqueueReview,
		[...done, result],
		resolvedServices,
	);
};

const publishResearchProposals = async (
	db: Db,
	proposals: readonly ResearchProposal[],
	enqueueReview: ReviewEnqueue,
): Promise<{
	readonly published: readonly PublishedResearch[];
	readonly resolvedServices: ReadonlySet<string>;
}> => {
	const resolvedServices = new Set<string>();
	const published = await publishRemaining(
		db,
		proposals,
		enqueueReview,
		[],
		resolvedServices,
	);
	return { published, resolvedServices };
};

export { publishResearchProposals };
export type {
	InstalmentProposal,
	PublishedResearch,
	RelationProposal,
	ResearchProposal,
	ReviewEnqueue,
	TitleProposal,
};
