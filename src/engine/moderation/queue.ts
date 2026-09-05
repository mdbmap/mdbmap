import { eq, inArray } from "drizzle-orm";

import {
	instalmentAssertions,
	pendingGroupCandidates,
	serviceInstalments,
	serviceTitles,
} from "@/db/engine-schema";
import type {
	CandidateEvidence,
	PendingCandidateKind,
} from "@/db/engine-schema";
import { survivorGroupId } from "@/engine/gateway";
import type { GatewayDb } from "@/engine/gateway";

// The moderation queue (ADR-0002 §Conflicts and review, issue #46). One table —
// `pending_group_candidates` — carries every kind an admin reviews: membership
// candidates (`structural`, `fuzzy-group`), assertion conflicts and the
// low-confidence review flag. This module reads the open queue and reports which
// conflicts hold a group's publication back; `actions.ts` acts on a row.

type CandidateRow = typeof pendingGroupCandidates.$inferSelect;

// The conflict kinds that keep a group's competing paths outside the published
// graph until a moderator settles them. Membership candidates and the review flag
// never block publication, so they are excluded here.
const conflictKinds = new Set<PendingCandidateKind>([
	"absence-assertion-conflict",
	"continuity-conflict",
	"instalment-assertion-conflict",
	"title-assertion-conflict",
]);

const ascending = (left: number, right: number): number => left - right;

const listOpenCandidates = async (
	db: GatewayDb,
): Promise<readonly CandidateRow[]> =>
	db
		.select()
		.from(pendingGroupCandidates)
		.where(eq(pendingGroupCandidates.status, "open"))
		.orderBy(pendingGroupCandidates.createdAt, pendingGroupCandidates.id)
		.all();

const loadCandidate = async (
	db: GatewayDb,
	candidateId: number,
): Promise<CandidateRow | undefined> => {
	const rows = await db
		.select()
		.from(pendingGroupCandidates)
		.where(eq(pendingGroupCandidates.id, candidateId))
		.all();
	return rows[0];
};

// The spoke ids owned by a group's member titles — the instalments a conflict may
// name — alongside the content units those spokes cover.
interface GroupScope {
	readonly spokeIds: ReadonlySet<number>;
	readonly titleIds: ReadonlySet<number>;
	readonly unitIds: ReadonlySet<string>;
}

const groupScope = async (
	db: GatewayDb,
	groupId: number,
): Promise<GroupScope> => {
	const survivor = await survivorGroupId(db, groupId);
	const titleRows = await db
		.select({ id: serviceTitles.id })
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, survivor))
		.all();
	const titleIds = titleRows.map((row) => row.id);
	const spokeRows =
		titleIds.length === 0
			? []
			: await db
					.select({ id: serviceInstalments.id })
					.from(serviceInstalments)
					.where(inArray(serviceInstalments.titleId, titleIds))
					.all();
	const spokeIds = spokeRows.map((row) => row.id);
	const unitRows =
		spokeIds.length === 0
			? []
			: await db
					.select({ unitId: instalmentAssertions.unitId })
					.from(instalmentAssertions)
					.where(inArray(instalmentAssertions.instalmentId, spokeIds))
					.all();
	const unitIds = unitRows.map((row) => row.unitId);
	return {
		spokeIds: new Set(spokeIds),
		titleIds: new Set(titleIds),
		unitIds: new Set(unitIds),
	};
};

// Does an open conflict of the given evidence name any part of the group's scope.
const evidenceTouchesScope = (
	evidence: CandidateEvidence,
	scope: GroupScope,
): boolean => {
	switch (evidence.kind) {
		case "absence-assertion-conflict": {
			return (
				scope.unitIds.has(evidence.unitId) ||
				scope.spokeIds.has(evidence.conflictingInstalmentId)
			);
		}
		case "continuity-conflict": {
			return evidence.competingRelations.some(
				(relation) =>
					scope.titleIds.has(relation.fromTitleId) ||
					scope.titleIds.has(relation.toTitleId),
			);
		}
		case "instalment-assertion-conflict": {
			return scope.spokeIds.has(evidence.instalmentId);
		}
		case "title-assertion-conflict": {
			return (
				scope.titleIds.has(evidence.proposed.titleAId) ||
				scope.titleIds.has(evidence.proposed.titleBId)
			);
		}
		case "fuzzy-group":
		case "low-confidence-flag":
		case "structural": {
			return false;
		}
	}
};

interface PublicationStatus {
	readonly blocked: boolean;
	readonly conflicts: readonly CandidateRow[];
}

// The open conflicts that keep a group outside the published graph. Each returned
// row carries its evidence — an instalment conflict's proposed and published
// sides, a title conflict's competing pair — so the admin surface can show both
// proposals. A group with no open conflict is not blocked and publishes normally.
const publicationStatus = async (
	db: GatewayDb,
	groupId: number,
): Promise<PublicationStatus> => {
	const scope = await groupScope(db, groupId);
	const open = await listOpenCandidates(db);
	const conflicts = open
		.filter((row) => conflictKinds.has(row.kind))
		.filter((row) => evidenceTouchesScope(row.evidence, scope))
		.toSorted((left, right) => ascending(left.id, right.id));
	return { blocked: conflicts.length > 0, conflicts };
};

export { conflictKinds, listOpenCandidates, loadCandidate, publicationStatus };
export type { CandidateRow, PublicationStatus };
