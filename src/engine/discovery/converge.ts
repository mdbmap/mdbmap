import { and, eq, inArray, or } from "drizzle-orm";

import { runAtomicBatch } from "@/db/atomic";
import type { PreparedBatch } from "@/db/atomic";
import {
	candidateSubjectKey,
	instalmentAssertions,
	pendingGroupCandidates,
	serviceInstalments,
	serviceTitles,
	titleAssertions,
	titleGroups,
} from "@/db/engine-schema";
import type {
	CandidateEvidence,
	CandidateSubject,
	GroupSource,
} from "@/db/engine-schema";
import { survivorGroupId } from "@/engine/gateway";
import type { GatewayDb } from "@/engine/gateway";
import { tierIds } from "@/engine/matcher";
import { reconcileCoveragesAfterMerge } from "@/engine/overflow/coverage.ts";
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
const isGroupCurated = async (
	db: GatewayDb,
	source: GroupSource,
	memberTitleIds: readonly number[],
): Promise<boolean> => {
	if (source === "manual") {
		return true;
	}
	if (memberTitleIds.length === 0) {
		return false;
	}
	const spokeRows = await db
		.select({ id: serviceInstalments.id })
		.from(serviceInstalments)
		.where(inArray(serviceInstalments.titleId, [...memberTitleIds]))
		.all();
	const spokeIds = spokeRows.map((row) => row.id);
	const spokeAssertions =
		spokeIds.length === 0
			? []
			: await db
					.select({ source: instalmentAssertions.source })
					.from(instalmentAssertions)
					.where(inArray(instalmentAssertions.instalmentId, spokeIds))
					.all();
	if (spokeAssertions.some((row) => isCuratedSource(row.source))) {
		return true;
	}
	const titles = [...memberTitleIds];
	const touchesMember = or(
		inArray(titleAssertions.titleAId, titles),
		inArray(titleAssertions.titleBId, titles),
	);
	const titleTouches = await db
		.select({ source: titleAssertions.source })
		.from(titleAssertions)
		.where(touchesMember)
		.all();
	return titleTouches.some((row) => isCuratedSource(row.source));
};

const readGroupSnapshot = async (
	db: GatewayDb,
	groupId: number,
): Promise<GroupSnapshot | undefined> => {
	const group = takeFirst(
		await db
			.select()
			.from(titleGroups)
			.where(eq(titleGroups.id, groupId))
			.all(),
	);
	if (group === undefined) {
		return undefined;
	}
	const memberRows = await db
		.select({ id: serviceTitles.id })
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, groupId))
		.all();
	const memberTitleIds = memberRows.map((row) => row.id).toSorted(ascending);
	return {
		curated: await isGroupCurated(db, group.source, memberTitleIds),
		groupId,
		ladderComplete: group.ladderComplete,
		memberTitleIds,
		source: group.source,
	};
};

// Resolve every named member to its stored title and the group it now lives in,
// then snapshot each involved group. Members with no stored title drop out — a
// group is only involved through a member that already exists.
const resolveStoredMember = async (
	db: GatewayDb,
	member: ConvergeMember,
): Promise<StoredMember | undefined> => {
	const match = and(
		eq(serviceTitles.service, member.service),
		eq(serviceTitles.serviceId, member.serviceId),
	);
	const title = takeFirst(
		await db.select().from(serviceTitles).where(match).all(),
	);
	if (title === undefined) {
		return undefined;
	}
	return {
		groupId: await survivorGroupId(db, title.groupId),
		ordinal: member.ordinal,
		service: member.service,
		serviceId: member.serviceId,
		titleId: title.id,
	};
};

const readConvergeState = async (
	db: GatewayDb,
	input: ConvergeInput,
): Promise<ConvergeState> => {
	const resolved = await Promise.all(
		input.members.map(async (member) => resolveStoredMember(db, member)),
	);
	const stored = resolved.filter(
		(member): member is StoredMember => member !== undefined,
	);
	const involvedIds = [
		...new Set(stored.map((member) => member.groupId)),
	].toSorted(ascending);
	const snapshotRows = await Promise.all(
		involvedIds.map(async (groupId) => readGroupSnapshot(db, groupId)),
	);
	const snapshots = snapshotRows.filter(
		(snapshot): snapshot is GroupSnapshot => snapshot !== undefined,
	);
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
	const anchorTitleId = Math.min(
		...state.stored.map((member) => member.titleId),
	);
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

// Queue the collision, coalescing on the open partial unique index: a repeat or
// concurrent discovery of the same subject and evidence inserts nothing and the
// outcome stays total, so an admin reviews one question rather than a pile.
const commitCandidate = async (
	db: GatewayDb,
	plan: Extract<ConvergePlan, { kind: "candidate" }>,
): Promise<ConvergeOutcome> => {
	const inserted = takeFirst(
		await db
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

const commitMerge = async (
	db: GatewayDb,
	plan: Extract<ConvergePlan, { kind: "merge" }>,
): Promise<ConvergeOutcome> => {
	const { acquired } = await runAtomicBatch(db, (database, operationId) => {
		const clauses: string[] = [];
		const bindings: (boolean | number | string)[] = [operationId];
		for (const snapshot of plan.precondition.snapshots) {
			clauses.push(`EXISTS (
				SELECT 1 FROM title_groups AS groups
				WHERE groups.id = ? AND groups.source = ? AND groups.ladder_complete = ?
				AND (SELECT count(*) FROM service_titles WHERE group_id = groups.id) = json_array_length(?)
				AND NOT EXISTS (
					SELECT 1 FROM json_each(?) AS expected
					WHERE NOT EXISTS (
						SELECT 1 FROM service_titles
						WHERE group_id = groups.id AND id = expected.value
					)
				)
				AND (CASE WHEN groups.source = 'manual'
					OR EXISTS (
						SELECT 1 FROM instalment_assertions AS assertions
						JOIN service_instalments AS instalments ON instalments.id = assertions.instalment_id
						JOIN service_titles AS titles ON titles.id = instalments.title_id
						WHERE titles.group_id = groups.id AND assertions.source NOT IN (${tierIds.map(() => "?").join(", ")})
					)
					OR EXISTS (
						SELECT 1 FROM title_assertions AS assertions
						WHERE assertions.source NOT IN (${tierIds.map(() => "?").join(", ")})
						AND (assertions.title_a_id IN (SELECT id FROM service_titles WHERE group_id = groups.id)
							OR assertions.title_b_id IN (SELECT id FROM service_titles WHERE group_id = groups.id))
					)
				THEN 1 ELSE 0 END) = ?
			)`);
			const members = JSON.stringify(snapshot.memberTitleIds);
			bindings.push(
				snapshot.groupId,
				snapshot.source,
				snapshot.ladderComplete,
				members,
				members,
				...tierIds,
				...tierIds,
				Number(snapshot.curated),
			);
		}
		const statements: PreparedBatch = [
			database
				.prepare(`INSERT INTO atomic_write_gates (operation_id)
					SELECT ? WHERE ${clauses.join(" AND ")}
					RETURNING operation_id`)
				.bind(...bindings),
		];
		const cases = plan.reassignments.map(() => "WHEN ? THEN ?").join(" ");
		const titleIds = plan.reassignments.map(({ titleId }) => titleId);
		statements.push(
			database
				.prepare(`UPDATE service_titles
					SET group_id = ?, ordinal = CASE id ${cases} ELSE ordinal END
					WHERE id IN (${titleIds.map(() => "?").join(", ")})
					AND EXISTS (SELECT 1 FROM atomic_write_gates WHERE operation_id = ?)`)
				.bind(
					plan.survivorId,
					...plan.reassignments.flatMap(({ ordinal, titleId }) => [
						titleId,
						ordinal,
					]),
					...titleIds,
					operationId,
				),
		);
		if (plan.retiredIds.length > 0) {
			statements.push(
				database
					.prepare(`UPDATE title_group_aliases SET survivor_group_id = ?
						WHERE survivor_group_id IN (${plan.retiredIds.map(() => "?").join(", ")})
						AND EXISTS (SELECT 1 FROM atomic_write_gates WHERE operation_id = ?)`)
					.bind(plan.survivorId, ...plan.retiredIds, operationId),
				...plan.retiredIds.map((retiredId) =>
					database
						.prepare(`INSERT INTO title_group_aliases (retired_group_id, survivor_group_id)
							SELECT ?, ? WHERE EXISTS (
								SELECT 1 FROM atomic_write_gates WHERE operation_id = ?
							)`)
						.bind(retiredId, plan.survivorId, operationId),
				),
			);
		}
		statements.push(
			database
				.prepare("DELETE FROM atomic_write_gates WHERE operation_id = ?")
				.bind(operationId),
		);
		return statements;
	});
	if (!acquired) {
		return { kind: "aborted" };
	}
	if (plan.retiredIds.length > 0) {
		await reconcileCoveragesAfterMerge(db, {
			retiredGroupIds: plan.retiredIds,
			survivorGroupId: plan.survivorId,
		});
	}
	return {
		kind: "merged",
		retiredIds: plan.retiredIds,
		survivorId: plan.survivorId,
	};
};

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
const readRevalidationMembers = async (
	db: GatewayDb,
	groupId: number,
): Promise<readonly RevalidationMember[]> => {
	const titles = await db
		.select()
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, groupId))
		.orderBy(serviceTitles.ordinal, serviceTitles.id)
		.all();
	return Promise.all(
		titles.map(async (title) => {
			const spokeRows = await db
				.select({ id: serviceInstalments.id })
				.from(serviceInstalments)
				.where(eq(serviceInstalments.titleId, title.id))
				.all();
			return {
				ordinal: title.ordinal,
				service: title.service,
				serviceId: title.serviceId,
				spokeIds: spokeRows.map((row) => row.id).toSorted(ascending),
				titleId: title.id,
			};
		}),
	);
};

// Read, plan and commit a convergence in one pass. The read and plan stay exposed
// so a caller can interleave its own reads before committing.
const convergeGroups = async (
	db: GatewayDb,
	input: ConvergeInput,
): Promise<ConvergeOutcome> => {
	const plan = planConverge(input, await readConvergeState(db, input));
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
