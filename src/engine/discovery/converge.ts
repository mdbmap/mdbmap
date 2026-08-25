import { and, eq, inArray, or } from "drizzle-orm";

import {
	candidateSubjectKey,
	instalmentAssertions,
	pendingGroupCandidates,
	serviceInstalments,
	serviceTitles,
	titleAssertions,
	titleGroupAliases,
	titleGroups,
} from "@/db/engine-schema";
import type {
	CandidateEvidence,
	CandidateSubject,
	GroupSource,
} from "@/db/engine-schema";
import { survivorGroupId } from "@/engine/gateway";
import type { GatewayDb } from "@/engine/gateway";
import { isCuratedSource } from "@/engine/recompute";

// A member the discovery named, in the order the discovery placed it (live
// first-air date, ascending). Only the derived position matters here; converge
// re-ranks the surviving union densely from these ordinals so the merged group's
// order is reproducible whichever member the resolve started from.
interface ConvergeMember {
	readonly ordinal: number;
	readonly service: string;
	readonly serviceId: string;
}

interface ConvergeInput {
	readonly members: readonly ConvergeMember[];
}

// One involved group as the plan assumed it: its stamp, its exact membership and
// whether a human has touched it. The commit re-reads this and aborts if any of
// it moved — the same compare-and-set discipline the recompute batch uses.
interface GroupSnapshot {
	readonly curated: boolean;
	readonly groupId: number;
	readonly ladderComplete: boolean;
	readonly memberTitleIds: readonly number[];
	readonly source: GroupSource;
}

interface ConvergePrecondition {
	readonly snapshots: readonly GroupSnapshot[];
}

// A stored title the discovery named: its own row plus the ordinal the discovery
// gave it, so the merge can re-rank the union without consulting live dates.
interface StoredMember {
	readonly groupId: number;
	readonly ordinal: number;
	readonly service: string;
	readonly serviceId: string;
	readonly titleId: number;
}

interface ConvergeState {
	readonly precondition: ConvergePrecondition;
	readonly stored: readonly StoredMember[];
}

// Each union title in its merged position: reassigned to the survivor and given a
// dense ordinal from the discovery's order.
interface MemberReassignment {
	readonly ordinal: number;
	readonly titleId: number;
}

type StructuralEvidence = Extract<CandidateEvidence, { kind: "structural" }>;

// A merge unions membership onto the lowest stored id; a candidate leaves every
// stored group untouched and queues the collision; no-op covers a discovery whose
// members are unstored or already share one group.
type ConvergePlan =
	| {
			readonly evidence: StructuralEvidence;
			readonly evidenceHash: string;
			readonly kind: "candidate";
			readonly reason: "curated" | "unnamed-member";
			readonly subject: CandidateSubject;
			readonly subjectKey: string;
	  }
	| { readonly kind: "no-op" }
	| {
			readonly kind: "merge";
			readonly precondition: ConvergePrecondition;
			readonly reassignments: readonly MemberReassignment[];
			readonly retiredIds: readonly number[];
			readonly survivorId: number;
	  };

type ConvergeOutcome =
	| { readonly kind: "aborted" }
	| { readonly candidateId: number | undefined; readonly kind: "candidate" }
	| {
			readonly kind: "merged";
			readonly retiredIds: readonly number[];
			readonly survivorId: number;
	  }
	| { readonly kind: "no-op" };

interface ServiceRef {
	readonly service: string;
	readonly serviceId: string;
}

const ascending = (left: number, right: number): number => left - right;

// Stable order over service refs — by service, then id — so a proposed membership
// canonicalises the same however a producer happened to order it.
const byServiceRef = (first: ServiceRef, second: ServiceRef): number => {
	if (first.service !== second.service) {
		return first.service < second.service ? -1 : 1;
	}
	if (first.serviceId !== second.serviceId) {
		return first.serviceId < second.serviceId ? -1 : 1;
	}
	return 0;
};

const toRef = (member: ConvergeMember): ServiceRef => ({
	service: member.service,
	serviceId: member.serviceId,
});

const takeFirst = <Row>(rows: readonly Row[]): Row | undefined => rows[0];

// A group is curated when a human has vouched for its membership, approved a
// correction, or paired instalments by hand — exact evidence alone never outranks
// any of these, so a collision with one queues a candidate instead of merging.
const isGroupCurated = (
	db: GatewayDb,
	source: GroupSource,
	memberTitleIds: readonly number[],
): boolean => {
	if (source === "manual") {
		return true;
	}
	if (memberTitleIds.length === 0) {
		return false;
	}
	const spokeIds = db
		.select({ id: serviceInstalments.id })
		.from(serviceInstalments)
		.where(inArray(serviceInstalments.titleId, [...memberTitleIds]))
		.all()
		.map((row) => row.id);
	const curatedSpoke =
		spokeIds.length > 0 &&
		db
			.select({ source: instalmentAssertions.source })
			.from(instalmentAssertions)
			.where(inArray(instalmentAssertions.instalmentId, spokeIds))
			.all()
			.some((row) => isCuratedSource(row.source));
	if (curatedSpoke) {
		return true;
	}
	const titles = [...memberTitleIds];
	const touchesMember = or(
		inArray(titleAssertions.titleAId, titles),
		inArray(titleAssertions.titleBId, titles),
	);
	return db
		.select({ source: titleAssertions.source })
		.from(titleAssertions)
		.where(touchesMember)
		.all()
		.some((row) => isCuratedSource(row.source));
};

const readGroupSnapshot = (
	db: GatewayDb,
	groupId: number,
): GroupSnapshot | undefined => {
	const group = takeFirst(
		db.select().from(titleGroups).where(eq(titleGroups.id, groupId)).all(),
	);
	if (group === undefined) {
		return undefined;
	}
	const memberTitleIds = db
		.select({ id: serviceTitles.id })
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, groupId))
		.all()
		.map((row) => row.id)
		.toSorted(ascending);
	return {
		curated: isGroupCurated(db, group.source, memberTitleIds),
		groupId,
		ladderComplete: group.ladderComplete,
		memberTitleIds,
		source: group.source,
	};
};

// Resolve every named member to its stored title and the group it now lives in,
// then snapshot each involved group. Members with no stored title drop out — a
// group is only involved through a member that already exists.
const readConvergeState = (
	db: GatewayDb,
	input: ConvergeInput,
): ConvergeState => {
	const stored: StoredMember[] = [];
	for (const member of input.members) {
		const match = and(
			eq(serviceTitles.service, member.service),
			eq(serviceTitles.serviceId, member.serviceId),
		);
		const title = takeFirst(
			db.select().from(serviceTitles).where(match).all(),
		);
		if (title === undefined) {
			continue;
		}
		stored.push({
			groupId: survivorGroupId(db, title.groupId),
			ordinal: member.ordinal,
			service: member.service,
			serviceId: member.serviceId,
			titleId: title.id,
		});
	}
	const involvedIds = [...new Set(stored.map((member) => member.groupId))].toSorted(
		ascending,
	);
	const snapshots = involvedIds
		.map((groupId) => readGroupSnapshot(db, groupId))
		.filter((snapshot): snapshot is GroupSnapshot => snapshot !== undefined);
	return { precondition: { snapshots }, stored };
};

const canonicalMembers = (members: readonly ConvergeMember[]): string =>
	JSON.stringify(members.map((member) => toRef(member)).toSorted(byServiceRef));

// The structural collision as a queued candidate: the competing stored groups and
// the membership the evidence proposed. Coalesces on repeat discovery through the
// open partial unique index — the same subject and evidence insert once.
const candidatePlan = (
	input: ConvergeInput,
	state: ConvergeState,
	reason: "curated" | "unnamed-member",
): ConvergePlan => {
	const competingGroupIds = state.precondition.snapshots
		.map((snapshot) => snapshot.groupId)
		.toSorted(ascending);
	const proposedMembers = input.members
		.map((member) => toRef(member))
		.toSorted(byServiceRef);
	const anchorTitleId = Math.min(...state.stored.map((member) => member.titleId));
	const subject: CandidateSubject = {
		subjectType: "title",
		titleId: anchorTitleId,
	};
	return {
		evidence: { competingGroupIds, kind: "structural", proposedMembers },
		evidenceHash: `structural:${JSON.stringify(competingGroupIds)}:${canonicalMembers(input.members)}`,
		kind: "candidate",
		reason,
		subject,
		subjectKey: candidateSubjectKey(subject),
	};
};

// Decide what a discovery does to the groups its members already occupy. Overlap
// across purely algorithmic groups merges onto the lowest stored id; any human
// touch, or a stored member the discovery never named, refuses whole and queues a
// candidate; a discovery already contained in one group changes nothing.
const planConverge = (
	input: ConvergeInput,
	state: ConvergeState,
): ConvergePlan => {
	const { snapshots } = state.precondition;
	// A discovery contained in a single stored group — or naming nothing stored —
	// proposes no merge and asserts no cross-group grouping. Machine evidence that
	// agrees with an existing grouping, curated or not, is not a collision; only a
	// merge across two groups can contradict a human or an unnamed member.
	if (snapshots.length < 2) {
		return { kind: "no-op" };
	}
	if (snapshots.some((snapshot) => snapshot.curated)) {
		return candidatePlan(input, state, "curated");
	}
	const namedTitleIds = new Set(state.stored.map((member) => member.titleId));
	const holdsUnnamed = snapshots.some((snapshot) =>
		snapshot.memberTitleIds.some((titleId) => !namedTitleIds.has(titleId)),
	);
	if (holdsUnnamed) {
		return candidatePlan(input, state, "unnamed-member");
	}
	const survivorId = Math.min(...snapshots.map((snapshot) => snapshot.groupId));
	const retiredIds = snapshots
		.map((snapshot) => snapshot.groupId)
		.filter((groupId) => groupId !== survivorId)
		.toSorted(ascending);
	// Rank the union by discovery order, breaking tied ordinals by service ref so
	// the persisted positions are reproducible whichever member the resolve began
	// from (ADR-0002's member-order tiebreak, applied where converge persists it).
	const ranked = [...state.stored].toSorted((left, right) => {
		const byOrdinal = ascending(left.ordinal, right.ordinal);
		return byOrdinal === 0 ? byServiceRef(left, right) : byOrdinal;
	});
	const reassignments = ranked.map((member, index) => ({
		ordinal: index,
		titleId: member.titleId,
	}));
	return {
		kind: "merge",
		precondition: state.precondition,
		reassignments,
		retiredIds,
		survivorId,
	};
};

const canonical = (precondition: ConvergePrecondition): string =>
	JSON.stringify(precondition);

// Re-read every involved group inside the write and compare it against the plan's
// assumption. A concurrent converge that got there first has moved a membership or
// curated a group, so the canonical mismatch aborts this batch untouched and the
// next request re-plans against the winner.
const reReadPrecondition = (
	db: GatewayDb,
	plan: Extract<ConvergePlan, { kind: "merge" }>,
): ConvergePrecondition => ({
	snapshots: plan.precondition.snapshots
		.map((snapshot) => readGroupSnapshot(db, snapshot.groupId))
		.filter((snapshot): snapshot is GroupSnapshot => snapshot !== undefined),
});

// Queue the collision, coalescing on the open partial unique index: a repeat or
// concurrent discovery of the same subject and evidence inserts nothing and the
// outcome stays total, so an admin reviews one question rather than a pile.
const commitCandidate = (
	db: GatewayDb,
	plan: Extract<ConvergePlan, { kind: "candidate" }>,
): ConvergeOutcome => {
	const inserted = takeFirst(
		db
			.insert(pendingGroupCandidates)
			.values({
				evidence: plan.evidence,
				evidenceHash: plan.evidenceHash,
				kind: "structural",
				subject: plan.subject,
				subjectKey: plan.subjectKey,
			})
			.onConflictDoNothing()
			.returning()
			.all(),
	);
	return { candidateId: inserted?.id, kind: "candidate" };
};

const commitMerge = (
	db: GatewayDb,
	plan: Extract<ConvergePlan, { kind: "merge" }>,
): ConvergeOutcome =>
	db.transaction((tx): ConvergeOutcome => {
		if (canonical(reReadPrecondition(tx, plan)) !== canonical(plan.precondition)) {
			return { kind: "aborted" };
		}
		for (const reassignment of plan.reassignments) {
			tx.update(serviceTitles)
				.set({ groupId: plan.survivorId, ordinal: reassignment.ordinal })
				.where(eq(serviceTitles.id, reassignment.titleId))
				.run();
		}
		// Flatten as we write: an id that already pointed at a now-retired group is
		// re-pointed to the survivor, and each retired group aliases the survivor —
		// one hop always reaches a group that holds members.
		if (plan.retiredIds.length > 0) {
			tx.update(titleGroupAliases)
				.set({ survivorGroupId: plan.survivorId })
				.where(inArray(titleGroupAliases.survivorGroupId, [...plan.retiredIds]))
				.run();
			for (const retiredId of plan.retiredIds) {
				tx.insert(titleGroupAliases)
					.values({ retiredGroupId: retiredId, survivorGroupId: plan.survivorId })
					.run();
			}
		}
		return { kind: "merged", retiredIds: plan.retiredIds, survivorId: plan.survivorId };
	});

// One stored member as a revalidation sees it: its title and the spokes it owns,
// read in stored ordinal order. Revalidation never rediscovers — there is no find
// client here — so an index hiccup cannot narrow the group and a corrected first-air
// date cannot reshuffle ids that are already public.
interface RevalidationMember {
	readonly ordinal: number;
	readonly service: string;
	readonly serviceId: string;
	readonly spokeIds: readonly number[];
	readonly titleId: number;
}

// Read a stored group's exact membership in its stored ordinal order (ties by id),
// each member carrying its spokes so a caller can remap without re-enumerating the
// group from a shared external id.
const readRevalidationMembers = (
	db: GatewayDb,
	groupId: number,
): readonly RevalidationMember[] => {
	const titles = db
		.select()
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, groupId))
		.orderBy(serviceTitles.ordinal, serviceTitles.id)
		.all();
	return titles.map((title) => ({
		ordinal: title.ordinal,
		service: title.service,
		serviceId: title.serviceId,
		spokeIds: db
			.select({ id: serviceInstalments.id })
			.from(serviceInstalments)
			.where(eq(serviceInstalments.titleId, title.id))
			.all()
			.map((row) => row.id)
			.toSorted(ascending),
		titleId: title.id,
	}));
};

// Read, plan and commit a convergence in one pass. The read and plan stay exposed
// so a caller can interleave its own reads before committing.
const convergeGroups = (
	db: GatewayDb,
	input: ConvergeInput,
): ConvergeOutcome => {
	const plan = planConverge(input, readConvergeState(db, input));
	switch (plan.kind) {
		case "candidate": {
			return commitCandidate(db, plan);
		}
		case "merge": {
			return commitMerge(db, plan);
		}
		case "no-op": {
			return { kind: "no-op" };
		}
	}
};

export {
	commitCandidate,
	commitMerge,
	convergeGroups,
	planConverge,
	readConvergeState,
	readGroupSnapshot,
	readRevalidationMembers,
};
export type {
	ConvergeInput,
	ConvergeMember,
	ConvergeOutcome,
	ConvergePlan,
	ConvergePrecondition,
	ConvergeState,
	GroupSnapshot,
	RevalidationMember,
	StoredMember,
};
