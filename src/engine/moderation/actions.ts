import { and, eq, inArray } from "drizzle-orm";

import {
	absenceAssertions,
	candidateSubjectKey,
	contentUnits,
	instalmentAssertions,
	pendingGroupCandidates,
	relationAssertions,
	serviceTitles,
	titleAssertions,
	titleGroups,
} from "@/db/engine-schema";
import type { CandidateEvidence, CandidateSubject } from "@/db/engine-schema";
import {
	acceptFuzzyCandidate,
	commitMerge,
	readGroupSnapshot,
	rejectFuzzyCandidate,
} from "@/engine/discovery";
import type { ConvergeOutcome, GroupSnapshot } from "@/engine/discovery";
import { survivorGroupId } from "@/engine/gateway";
import type { GatewayDb } from "@/engine/gateway";

import { loadCandidate } from "./queue.ts";
import type { CandidateRow } from "./queue.ts";

// Admin actions over the moderation queue (issue #46). Every action stamps
// `manual` provenance and lands through the curated attach + CAS-batch paths that
// converge, fuzzy and recompute already use, so the recompute's curated-preserving
// pass keeps whatever a moderator settles here. Nothing widens the schema.

const MANUAL = "manual" as const;

const ascending = (left: number, right: number): number => left - right;

const takeFirst = <Row>(rows: readonly Row[]): Row | undefined => rows[0];

type ConflictEvidence = Extract<
	CandidateEvidence,
	{
		kind:
			| "absence-assertion-conflict"
			| "continuity-conflict"
			| "instalment-assertion-conflict"
			| "title-assertion-conflict";
	}
>;

// --- Membership candidates (structural + fuzzy) -----------------------------

type MembershipOutcome =
	| { readonly attachedTitleIds: readonly number[]; readonly kind: "accepted" }
	| { readonly kind: "aborted" }
	| { readonly kind: "missing" }
	| { readonly kind: "not-open" }
	| { readonly kind: "rejected" }
	| { readonly kind: "wrong-kind" };

// The union of the competing groups' member titles, ranked survivor-first then by
// each group's stored order, so the merged positions are reproducible.
const rankedUnion = (
	db: GatewayDb,
	survivorId: number,
	retiredIds: readonly number[],
): readonly { readonly ordinal: number; readonly titleId: number }[] => {
	const groupIds = [survivorId, ...retiredIds];
	const rankOf = (groupId: number): number =>
		groupId === survivorId ? 0 : retiredIds.indexOf(groupId) + 1;
	const members = db
		.select({
			groupId: serviceTitles.groupId,
			id: serviceTitles.id,
			ordinal: serviceTitles.ordinal,
		})
		.from(serviceTitles)
		.where(inArray(serviceTitles.groupId, groupIds))
		.all();
	return members
		.toSorted(
			(left, right) =>
				rankOf(left.groupId) - rankOf(right.groupId) ||
				ascending(left.ordinal, right.ordinal) ||
				ascending(left.id, right.id),
		)
		.map((member, index) => ({ ordinal: index, titleId: member.id }));
};

// Force the merge a structural collision refused, then vouch for the survivor. The
// merge reuses converge's CAS batch (`commitMerge`), so a concurrent write that
// moved any involved group aborts untouched; the follow-up stamps the survivor
// `manual` and closes the candidate.
const acceptStructural = (
	db: GatewayDb,
	candidate: CandidateRow,
): MembershipOutcome => {
	const { evidence } = candidate;
	if (evidence.kind !== "structural") {
		return { kind: "wrong-kind" };
	}
	const groupIds = [
		...new Set(evidence.competingGroupIds.map((groupId) => survivorGroupId(db, groupId))),
	].toSorted(ascending);
	const [survivorId] = groupIds;
	if (survivorId === undefined) {
		return { kind: "missing" };
	}
	const retiredIds = groupIds.filter((groupId) => groupId !== survivorId);
	const stampAndClose = (): MembershipOutcome => {
		db.update(titleGroups)
			.set({ source: MANUAL })
			.where(eq(titleGroups.id, survivorId))
			.run();
		db.update(pendingGroupCandidates)
			.set({ status: "accepted" })
			.where(eq(pendingGroupCandidates.id, candidate.id))
			.run();
		return { attachedTitleIds: [], kind: "accepted" };
	};
	if (retiredIds.length === 0) {
		return stampAndClose();
	}
	const snapshots = groupIds
		.map((groupId) => readGroupSnapshot(db, groupId))
		.filter((snapshot): snapshot is GroupSnapshot => snapshot !== undefined);
	const outcome: ConvergeOutcome = commitMerge(db, {
		kind: "merge",
		precondition: { snapshots },
		reassignments: rankedUnion(db, survivorId, retiredIds),
		retiredIds,
		survivorId,
	});
	if (outcome.kind === "aborted") {
		return { kind: "aborted" };
	}
	return stampAndClose();
};

// Accept a membership candidate through the curated attach path: a fuzzy proposal
// joins the subject's group (stamping `manual`), a structural collision merges its
// competing groups. Both leave the merged membership for the recompute to preserve.
const acceptMembership = (db: GatewayDb, candidateId: number): MembershipOutcome => {
	const candidate = loadCandidate(db, candidateId);
	if (candidate === undefined) {
		return { kind: "missing" };
	}
	if (candidate.status !== "open") {
		return { kind: "not-open" };
	}
	if (candidate.kind === "fuzzy-group") {
		const result = acceptFuzzyCandidate(db, candidateId);
		if (result.kind === "accepted") {
			return { attachedTitleIds: result.attachedTitleIds, kind: "accepted" };
		}
		return result.kind === "not-open" ? { kind: "not-open" } : { kind: "missing" };
	}
	if (candidate.kind === "structural") {
		return acceptStructural(db, candidate);
	}
	return { kind: "wrong-kind" };
};

// Reject a membership candidate, recording the verdict so a repeat discovery of the
// same proposal finds it. Fuzzy rejection reuses the discovery path's rejection.
const rejectMembership = (db: GatewayDb, candidateId: number): MembershipOutcome => {
	const candidate = loadCandidate(db, candidateId);
	if (candidate === undefined) {
		return { kind: "missing" };
	}
	if (candidate.status !== "open") {
		return { kind: "not-open" };
	}
	if (candidate.kind === "fuzzy-group") {
		const result = rejectFuzzyCandidate(db, candidateId);
		return result.kind === "rejected" ? { kind: "rejected" } : { kind: result.kind };
	}
	if (candidate.kind === "structural") {
		db.update(pendingGroupCandidates)
			.set({ status: "rejected" })
			.where(eq(pendingGroupCandidates.id, candidateId))
			.run();
		return { kind: "rejected" };
	}
	return { kind: "wrong-kind" };
};

// --- Assertion conflicts ----------------------------------------------------

interface SettleInput {
	readonly accept: boolean;
	readonly candidateId: number;
	// Which competing relation to accept for a continuity conflict; defaults to the
	// first. Ignored by the other conflict kinds.
	readonly relationIndex?: number | undefined;
}

type SettleOutcome =
	| { readonly kind: "missing" }
	| { readonly kind: "not-open" }
	| { readonly kind: "rejected" }
	| { readonly kind: "settled" }
	| { readonly kind: "wrong-kind" };

// Attach the proposed side of a conflict as a `manual` assertion — the curated
// evidence a recompute preserves. Each kind writes exactly the edge its evidence
// describes.
const acceptProposal = (
	db: GatewayDb,
	evidence: ConflictEvidence,
	relationIndex: number,
): boolean => {
	switch (evidence.kind) {
		case "absence-assertion-conflict": {
			db.insert(absenceAssertions)
				.values({
					coverageRevision: evidence.coverageRevision,
					source: MANUAL,
					targetService: evidence.targetService,
					unitId: evidence.unitId,
				})
				.onConflictDoNothing()
				.run();
			return true;
		}
		case "continuity-conflict": {
			const relation = evidence.competingRelations[relationIndex];
			if (relation === undefined) {
				return false;
			}
			db.insert(relationAssertions)
				.values({
					confidence: "high",
					fromTitleId: relation.fromTitleId,
					source: MANUAL,
					toTitleId: relation.toTitleId,
				})
				.onConflictDoNothing()
				.run();
			return true;
		}
		case "instalment-assertion-conflict": {
			db.insert(instalmentAssertions)
				.values({
					confidence: evidence.proposed.confidence,
					instalmentId: evidence.instalmentId,
					source: MANUAL,
					unitId: evidence.proposed.unitId,
				})
				.onConflictDoNothing()
				.run();
			return true;
		}
		case "title-assertion-conflict": {
			const lowId = Math.min(evidence.proposed.titleAId, evidence.proposed.titleBId);
			const highId = Math.max(evidence.proposed.titleAId, evidence.proposed.titleBId);
			db.insert(titleAssertions)
				.values({
					confidence: evidence.proposed.confidence,
					source: MANUAL,
					titleAId: lowId,
					titleBId: highId,
				})
				.onConflictDoNothing()
				.run();
			return true;
		}
	}
};

const conflictEvidence = (row: CandidateRow): ConflictEvidence | undefined => {
	const { evidence } = row;
	return evidence.kind === "fuzzy-group" ||
		evidence.kind === "structural" ||
		evidence.kind === "low-confidence-flag"
		? undefined
		: evidence;
};

// Settle a queued conflict. Accepting publishes the proposed side as a `manual`
// assertion and closes the row; rejecting records the verdict and leaves the
// published side standing, so readers keep the previous complete revision.
const settleConflict = (db: GatewayDb, input: SettleInput): SettleOutcome =>
	db.transaction((tx): SettleOutcome => {
		const candidate = loadCandidate(tx, input.candidateId);
		if (candidate === undefined) {
			return { kind: "missing" };
		}
		if (candidate.status !== "open") {
			return { kind: "not-open" };
		}
		const evidence = conflictEvidence(candidate);
		if (evidence === undefined) {
			return { kind: "wrong-kind" };
		}
		if (!input.accept) {
			tx.update(pendingGroupCandidates)
				.set({ status: "rejected" })
				.where(eq(pendingGroupCandidates.id, input.candidateId))
				.run();
			return { kind: "rejected" };
		}
		if (!acceptProposal(tx, evidence, input.relationIndex ?? 0)) {
			return { kind: "wrong-kind" };
		}
		tx.update(pendingGroupCandidates)
			.set({ status: "accepted" })
			.where(eq(pendingGroupCandidates.id, input.candidateId))
			.run();
		return { kind: "settled" };
	});

// --- Low-confidence review flag ---------------------------------------------

type FlagOutcome =
	| { readonly kind: "cleared" }
	| { readonly kind: "kept" }
	| { readonly kind: "missing" }
	| { readonly kind: "not-open" }
	| { readonly kind: "wrong-kind" };

const withOpenFlag = (
	db: GatewayDb,
	candidateId: number,
	act: (row: CandidateRow) => FlagOutcome,
): FlagOutcome => {
	const candidate = loadCandidate(db, candidateId);
	if (candidate === undefined) {
		return { kind: "missing" };
	}
	if (candidate.status !== "open") {
		return { kind: "not-open" };
	}
	if (candidate.kind !== "low-confidence-flag") {
		return { kind: "wrong-kind" };
	}
	return act(candidate);
};

// Clear a review flag: the low-confidence link stays published and visible, the row
// leaves the queue. The graph is untouched — only the flag is resolved.
const clearReviewFlag = (db: GatewayDb, candidateId: number): FlagOutcome =>
	withOpenFlag(db, candidateId, (candidate) => {
		db.update(pendingGroupCandidates)
			.set({ status: "accepted" })
			.where(eq(pendingGroupCandidates.id, candidate.id))
			.run();
		return { kind: "cleared" };
	});

// Keep a review flag open for a later pass — an explicit no-op that leaves the row
// in the queue.
const keepReviewFlag = (db: GatewayDb, candidateId: number): FlagOutcome =>
	withOpenFlag(db, candidateId, () => ({ kind: "kept" }));

// --- Group-level fiats ------------------------------------------------------

type MarkMatchedOutcome =
	| { readonly groupId: number; readonly kind: "matched" }
	| { readonly kind: "missing" };

// The "mark as matched" vouch (ADR-0002 §Provenance): the survivor group turns
// `manual`, which a recompute preserves alongside its status and membership.
const markAsMatched = (db: GatewayDb, groupId: number): MarkMatchedOutcome => {
	const survivor = survivorGroupId(db, groupId);
	const group = takeFirst(
		db.select().from(titleGroups).where(eq(titleGroups.id, survivor)).all(),
	);
	if (group === undefined) {
		return { kind: "missing" };
	}
	db.update(titleGroups).set({ source: MANUAL }).where(eq(titleGroups.id, survivor)).run();
	return { groupId: survivor, kind: "matched" };
};

interface ManualPairingInput {
	readonly instalmentIds: readonly number[];
	// Cover an existing unit, or omit to mint a fresh one for the pairing.
	readonly unitId?: number | undefined;
}

type ManualPairingOutcome =
	| {
			readonly assertionIds: readonly number[];
			readonly kind: "paired";
			readonly unitId: number;
	  }
	| { readonly kind: "empty" };

// Pair instalments by hand onto one content unit through the curated attach path:
// each spoke gets a `manual`, high-confidence instalment assertion. A merge or
// split is just several spokes sharing the unit.
const manualPairing = (
	db: GatewayDb,
	input: ManualPairingInput,
): ManualPairingOutcome =>
	db.transaction((tx): ManualPairingOutcome => {
		if (input.instalmentIds.length === 0) {
			return { kind: "empty" };
		}
		const unitId =
			input.unitId ??
			takeFirst(tx.insert(contentUnits).values({}).returning().all())?.id;
		if (unitId === undefined) {
			throw new Error("content unit insert returned no row");
		}
		const assertionIds: number[] = [];
		for (const instalmentId of input.instalmentIds) {
			const inserted = takeFirst(
				tx
					.insert(instalmentAssertions)
					.values({ confidence: "high", instalmentId, source: MANUAL, unitId })
					.onConflictDoNothing()
					.returning()
					.all(),
			);
			if (inserted !== undefined) {
				assertionIds.push(inserted.id);
			}
		}
		return { assertionIds, kind: "paired", unitId };
	});

// --- Conflict producer guard ------------------------------------------------

interface QueueConflictInput {
	readonly evidence: ConflictEvidence;
	readonly subject: CandidateSubject;
}

type QueueConflictOutcome =
	| { readonly candidateId: number | undefined; readonly kind: "auto-rejected" }
	| { readonly candidateId: number | undefined; readonly kind: "queued" };

// The proposed side canonicalised so a repeat discovery coalesces on the open
// partial unique index and a settled verdict is found again.
const evidenceHashOf = (evidence: ConflictEvidence): string => {
	switch (evidence.kind) {
		case "absence-assertion-conflict": {
			return `absence-assertion-conflict:${evidence.unitId}:${evidence.targetService}:${evidence.coverageRevision}`;
		}
		case "continuity-conflict": {
			return `continuity-conflict:${evidence.entryId}`;
		}
		case "instalment-assertion-conflict": {
			return `instalment-assertion-conflict:${evidence.instalmentId}:${evidence.proposed.unitId}`;
		}
		case "title-assertion-conflict": {
			const lowId = Math.min(evidence.proposed.titleAId, evidence.proposed.titleBId);
			const highId = Math.max(evidence.proposed.titleAId, evidence.proposed.titleBId);
			return `title-assertion-conflict:${lowId},${highId}`;
		}
	}
};

// A prior `manual` assertion already standing on the contested edge. Manual
// evidence outranks algorithmic (ADR-0002 §Conflicts and review), so its presence
// rejects a competing proposal outright rather than queuing it.
const priorManualAssertion = (db: GatewayDb, evidence: ConflictEvidence): boolean => {
	if (evidence.kind === "instalment-assertion-conflict") {
		return db
			.select({ source: instalmentAssertions.source })
			.from(instalmentAssertions)
			.where(eq(instalmentAssertions.instalmentId, evidence.instalmentId))
			.all()
			.some((row) => row.source === MANUAL);
	}
	if (evidence.kind === "title-assertion-conflict") {
		const lowId = Math.min(evidence.proposed.titleAId, evidence.proposed.titleBId);
		const highId = Math.max(evidence.proposed.titleAId, evidence.proposed.titleBId);
		return db
			.select({ source: titleAssertions.source })
			.from(titleAssertions)
			.where(and(eq(titleAssertions.titleAId, lowId), eq(titleAssertions.titleBId, highId)))
			.all()
			.some((row) => row.source === MANUAL);
	}
	return false;
};

// The producer entry the matcher and discovery call when competing algorithmic
// paths contradict. A prior manual assertion auto-rejects the proposal (nothing is
// published on either side, the manual edge stands); otherwise the conflict queues
// as one open row, coalescing on repeat discovery.
const queueAssertionConflict = (
	db: GatewayDb,
	input: QueueConflictInput,
): QueueConflictOutcome => {
	const evidenceHash = evidenceHashOf(input.evidence);
	const subjectKey = candidateSubjectKey(input.subject);
	const values = {
		evidence: input.evidence,
		evidenceHash,
		kind: input.evidence.kind,
		subject: input.subject,
		subjectKey,
	};
	if (priorManualAssertion(db, input.evidence)) {
		const inserted = takeFirst(
			db
				.insert(pendingGroupCandidates)
				.values({ ...values, status: "rejected" })
				.returning()
				.all(),
		);
		return { candidateId: inserted?.id, kind: "auto-rejected" };
	}
	const inserted = takeFirst(
		db.insert(pendingGroupCandidates).values(values).onConflictDoNothing().returning().all(),
	);
	return { candidateId: inserted?.id, kind: "queued" };
};

export {
	acceptMembership,
	clearReviewFlag,
	keepReviewFlag,
	manualPairing,
	markAsMatched,
	queueAssertionConflict,
	rejectMembership,
	settleConflict,
};
export type {
	ConflictEvidence,
	FlagOutcome,
	ManualPairingInput,
	ManualPairingOutcome,
	MarkMatchedOutcome,
	MembershipOutcome,
	QueueConflictInput,
	QueueConflictOutcome,
	SettleInput,
	SettleOutcome,
};
