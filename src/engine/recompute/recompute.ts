import { eq, inArray } from "drizzle-orm";

import { runAtomicBatch } from "@/db/atomic";
import type { PreparedBatch } from "@/db/atomic";
import {
	absenceAssertions,
	instalmentAssertions,
	serviceInstalments,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import type {
	AssertionConfidence,
	AssertionSource,
	GroupSource,
} from "@/db/engine-schema";
import type { GatewayDb } from "@/engine/gateway";
import { tierIds } from "@/engine/matcher";
import type { TierId } from "@/engine/matcher";

// The tiers the deterministic matcher stamps. A recompute re-runs only that
// matcher (ADR-0004), so anything else — a research pass (`llm-research`,
// `llm-verified`) or a human's curation (`community`, `manual`) — cannot be
// re-derived and is preserved rather than dropped, consistent with all four
// outranking the tiers in the serializer's precedence.
const algorithmicSources: ReadonlySet<AssertionSource> =
	new Set<AssertionSource>(tierIds);

const scaffoldingSources: ReadonlySet<AssertionSource> = new Set(["bootstrap"]);

// Every provenance the deterministic matcher does not itself produce. A recompute
// re-derives the algorithmic links and merges around these (ADR-0002).
const isCuratedSource = (source: AssertionSource): boolean =>
	!algorithmicSources.has(source) && !scaffoldingSources.has(source);

// One fresh pairing the matcher re-derived: the spokes that cover a single shared
// content unit, with the tier and grade that placed them. A regular pairing names
// one spoke per side; a verified split or merge names several on one side.
interface FreshPairing {
	readonly confidence: AssertionConfidence;
	readonly source: TierId;
	readonly spokeIds: readonly number[];
}

interface RecomputeInput {
	readonly groupId: number;
	// Did an untruncated T3 run evaluate every instalment this pass.
	readonly ladderComplete: boolean;
	readonly pairings: readonly FreshPairing[];
	// The highest tier the ladder reached; recorded as the group's own source
	// unless an admin vouched for the group itself (a `manual` group row).
	readonly triedSource: TierId;
}

// The exact reads the merge plan assumed: the group's stamp and source, its
// membership, the assertions curation owns, and the algorithmic links this plan
// will delete. The commit is a compare-and-set on this — a correction approved in
// the window, or a concurrent recompute that already re-derived the links, moves
// it and aborts the batch untouched.
interface RecomputePrecondition {
	readonly algorithmicAssertionIds: readonly number[];
	readonly curatedAbsenceIds: readonly number[];
	readonly curatedAssertionIds: readonly number[];
	readonly groupId: number;
	readonly ladderComplete: boolean;
	readonly memberTitleIds: readonly number[];
	readonly source: GroupSource;
}

// A read of everything the recompute needs: the compare-and-set precondition plus
// the spokes curation holds, which a fresh pairing may not take.
interface GroupState {
	readonly curatedSpokeIds: ReadonlySet<number>;
	readonly precondition: RecomputePrecondition;
}

// One surviving pairing becomes a new content unit covered by every spoke on it.
interface PlannedUnit {
	readonly links: readonly {
		readonly confidence: AssertionConfidence;
		readonly source: TierId;
		readonly spokeId: number;
	}[];
}

interface RecomputePlan {
	readonly deleteAssertionIds: readonly number[];
	// A fresh pairing that wanted a spoke curation holds; its surviving spokes stay
	// unlinked rather than contradicting the curation (ADR-0002 §Provenance).
	readonly droppedPairings: readonly FreshPairing[];
	readonly newUnits: readonly PlannedUnit[];
	readonly precondition: RecomputePrecondition;
	// Absent when an admin vouched for the group itself: its stamp and source are
	// preserved. Present otherwise, recording the highest tier this pass tried.
	readonly stamp:
		| { readonly ladderComplete: boolean; readonly source: GroupSource }
		| undefined;
}

type RecomputeOutcome =
	| { readonly kind: "aborted" }
	| { readonly kind: "applied"; readonly plan: RecomputePlan };

const ascending = (left: number, right: number): number => left - right;

const takeFirst = <Row>(rows: readonly Row[]): Row | undefined => rows[0];

// Read the group's stamp, membership and every assertion on its spokes, splitting
// curated provenance from algorithmic so the plan can preserve the former.
const readGroupState = async (
	db: GatewayDb,
	groupId: number,
): Promise<GroupState | undefined> => {
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
	const spokeRows =
		memberTitleIds.length === 0
			? []
			: await db
					.select({ id: serviceInstalments.id })
					.from(serviceInstalments)
					.where(inArray(serviceInstalments.titleId, memberTitleIds))
					.all();
	const spokeIds = spokeRows.map((row) => row.id);
	const assertions =
		spokeIds.length === 0
			? []
			: await db
					.select()
					.from(instalmentAssertions)
					.where(inArray(instalmentAssertions.instalmentId, spokeIds))
					.all();
	const curated = assertions.filter((row) => isCuratedSource(row.source));
	const algorithmic = assertions.filter((row) =>
		algorithmicSources.has(row.source),
	);
	const coveredUnitIds = [...new Set(assertions.map((row) => row.unitId))];
	const absences =
		coveredUnitIds.length === 0
			? []
			: await db
					.select()
					.from(absenceAssertions)
					.where(inArray(absenceAssertions.unitId, coveredUnitIds))
					.all();
	const curatedAbsenceIds = absences
		.filter((row) => isCuratedSource(row.source))
		.map((row) => row.id)
		.toSorted(ascending);
	return {
		curatedSpokeIds: new Set(
			curated
				.filter((row) => row.source !== "bootstrap")
				.map((row) => row.instalmentId),
		),
		precondition: {
			algorithmicAssertionIds: algorithmic
				.map((row) => row.id)
				.toSorted(ascending),
			curatedAbsenceIds,
			curatedAssertionIds: curated.map((row) => row.id).toSorted(ascending),
			groupId,
			ladderComplete: group.ladderComplete,
			memberTitleIds,
			source: group.source,
		},
	};
};

// Merge the fresh alignment around curation: drop every algorithmic link, keep
// the curated ones, and materialise only the pairings that take no spoke curation
// already holds. A `manual` group was vouched for whole, so its stamp is kept.
const planRecompute = (
	state: GroupState,
	input: RecomputeInput,
): RecomputePlan => {
	const newUnits: PlannedUnit[] = [];
	const droppedPairings: FreshPairing[] = [];
	for (const pairing of input.pairings) {
		const collides = pairing.spokeIds.some((spokeId) =>
			state.curatedSpokeIds.has(spokeId),
		);
		if (collides) {
			droppedPairings.push(pairing);
			continue;
		}
		newUnits.push({
			links: pairing.spokeIds.map((spokeId) => ({
				confidence: pairing.confidence,
				source: pairing.source,
				spokeId,
			})),
		});
	}
	const vouched = state.precondition.source === "manual";
	return {
		deleteAssertionIds: state.precondition.algorithmicAssertionIds,
		droppedPairings,
		newUnits,
		precondition: state.precondition,
		stamp: vouched
			? undefined
			: { ladderComplete: input.ladderComplete, source: input.triedSource },
	};
};

// Compare-and-set: re-read the group inside the write and abort untouched if any
// precondition moved since the plan was made. Otherwise drop the algorithmic
// links, write the surviving pairings as fresh units, and restamp the group.
const commitRecompute = async (
	db: GatewayDb,
	plan: RecomputePlan,
): Promise<RecomputeOutcome> => {
	const { precondition } = plan;
	const memberIds = JSON.stringify(precondition.memberTitleIds);
	const algorithmicIds = JSON.stringify(precondition.algorithmicAssertionIds);
	const curatedIds = JSON.stringify(precondition.curatedAssertionIds);
	const curatedAbsenceIds = JSON.stringify(precondition.curatedAbsenceIds);
	const sources = tierIds.map(() => "?").join(", ");
	const { acquired } = await runAtomicBatch(db, (database, operationId) => {
		const gate = database
			.prepare(`INSERT INTO atomic_write_gates (operation_id)
				SELECT ? WHERE EXISTS (
					SELECT 1 FROM title_groups AS groups
					WHERE groups.id = ? AND groups.source = ? AND groups.ladder_complete = ?
					AND (SELECT count(*) FROM service_titles WHERE group_id = groups.id) = json_array_length(?)
					AND NOT EXISTS (
						SELECT 1 FROM json_each(?) AS expected
						WHERE NOT EXISTS (
							SELECT 1 FROM service_titles WHERE group_id = groups.id AND id = expected.value
						)
					)
					AND (
						SELECT count(*) FROM instalment_assertions AS assertions
						JOIN service_instalments AS instalments ON instalments.id = assertions.instalment_id
						JOIN service_titles AS titles ON titles.id = instalments.title_id
						WHERE titles.group_id = groups.id AND assertions.source IN (${sources})
					) = json_array_length(?)
					AND NOT EXISTS (
						SELECT 1 FROM json_each(?) AS expected
						WHERE NOT EXISTS (
							SELECT 1 FROM instalment_assertions AS assertions
							JOIN service_instalments AS instalments ON instalments.id = assertions.instalment_id
							JOIN service_titles AS titles ON titles.id = instalments.title_id
							WHERE titles.group_id = groups.id AND assertions.id = expected.value
							AND assertions.source IN (${sources})
						)
					)
					AND (
						SELECT count(*) FROM instalment_assertions AS assertions
						JOIN service_instalments AS instalments ON instalments.id = assertions.instalment_id
						JOIN service_titles AS titles ON titles.id = instalments.title_id
						WHERE titles.group_id = groups.id AND assertions.source NOT IN (${sources})
					) = json_array_length(?)
					AND NOT EXISTS (
						SELECT 1 FROM json_each(?) AS expected
						WHERE NOT EXISTS (
							SELECT 1 FROM instalment_assertions AS assertions
							JOIN service_instalments AS instalments ON instalments.id = assertions.instalment_id
							JOIN service_titles AS titles ON titles.id = instalments.title_id
							WHERE titles.group_id = groups.id AND assertions.id = expected.value
							AND assertions.source NOT IN (${sources})
						)
					)
					AND (
						SELECT count(*) FROM absence_assertions AS absences
						WHERE absences.source NOT IN (${sources}) AND absences.unit_id IN (
							SELECT assertions.unit_id FROM instalment_assertions AS assertions
							JOIN service_instalments AS instalments ON instalments.id = assertions.instalment_id
							JOIN service_titles AS titles ON titles.id = instalments.title_id
							WHERE titles.group_id = groups.id
						)
					) = json_array_length(?)
					AND NOT EXISTS (
						SELECT 1 FROM json_each(?) AS expected
						WHERE NOT EXISTS (
							SELECT 1 FROM absence_assertions AS absences
							WHERE absences.id = expected.value AND absences.source NOT IN (${sources})
							AND absences.unit_id IN (
								SELECT assertions.unit_id FROM instalment_assertions AS assertions
								JOIN service_instalments AS instalments ON instalments.id = assertions.instalment_id
								JOIN service_titles AS titles ON titles.id = instalments.title_id
								WHERE titles.group_id = groups.id
							)
						)
					)
				)
				RETURNING operation_id`)
			.bind(
				operationId,
				precondition.groupId,
				precondition.source,
				Number(precondition.ladderComplete),
				memberIds,
				memberIds,
				...tierIds,
				algorithmicIds,
				algorithmicIds,
				...tierIds,
				...tierIds,
				curatedIds,
				curatedIds,
				...tierIds,
				...tierIds,
				curatedAbsenceIds,
				curatedAbsenceIds,
				...tierIds,
			);
		const statements: PreparedBatch = [gate];
		if (plan.deleteAssertionIds.length > 0) {
			statements.push(
				database
					.prepare(`DELETE FROM instalment_assertions
						WHERE id IN (${plan.deleteAssertionIds.map(() => "?").join(", ")})
						AND EXISTS (SELECT 1 FROM atomic_write_gates WHERE operation_id = ?)`)
					.bind(...plan.deleteAssertionIds, operationId),
			);
		}
		for (const unit of plan.newUnits) {
			const unitId = crypto.randomUUID();
			statements.push(
				database
					.prepare(`INSERT INTO content_units (id)
						SELECT ? WHERE EXISTS (
							SELECT 1 FROM atomic_write_gates WHERE operation_id = ?
						)`)
					.bind(unitId, operationId),
				...unit.links.map((link) =>
					database
						.prepare(`INSERT INTO instalment_assertions
							(instalment_id, unit_id, source, confidence)
							SELECT ?, ?, ?, ? WHERE EXISTS (
								SELECT 1 FROM atomic_write_gates WHERE operation_id = ?
							)`)
						.bind(
							link.spokeId,
							unitId,
							link.source,
							link.confidence,
							operationId,
						),
				),
			);
		}
		if (plan.stamp !== undefined) {
			statements.push(
				database
					.prepare(`UPDATE title_groups SET ladder_complete = ?, source = ?
						WHERE id = ? AND EXISTS (
							SELECT 1 FROM atomic_write_gates WHERE operation_id = ?
						)`)
					.bind(
						Number(plan.stamp.ladderComplete),
						plan.stamp.source,
						precondition.groupId,
						operationId,
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
	return acquired ? { kind: "applied", plan } : { kind: "aborted" };
};

// Read, plan and commit in one pass for callers with no correction window to
// model. The plan and commit stay separate so a caller can interleave reads.
const recomputeGroup = async (
	db: GatewayDb,
	input: RecomputeInput,
): Promise<RecomputeOutcome> => {
	const state = await readGroupState(db, input.groupId);
	if (state === undefined) {
		return { kind: "aborted" };
	}
	return commitRecompute(db, planRecompute(state, input));
};

export {
	commitRecompute,
	isCuratedSource,
	planRecompute,
	readGroupState,
	recomputeGroup,
};
export type {
	FreshPairing,
	GroupState,
	PlannedUnit,
	RecomputeInput,
	RecomputeOutcome,
	RecomputePlan,
	RecomputePrecondition,
};
