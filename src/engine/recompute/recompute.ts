import { eq, inArray } from "drizzle-orm";

import {
	absenceAssertions,
	contentUnits,
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
const algorithmicSources: ReadonlySet<AssertionSource> = new Set<AssertionSource>(
	tierIds,
);

// Every provenance the deterministic matcher does not itself produce. A recompute
// re-derives the algorithmic links and merges around these (ADR-0002).
const isCuratedSource = (source: AssertionSource): boolean =>
	!algorithmicSources.has(source);

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
	readonly stamp: { readonly ladderComplete: boolean; readonly source: GroupSource } | undefined;
}

type RecomputeOutcome =
	| { readonly kind: "aborted" }
	| { readonly kind: "applied"; readonly plan: RecomputePlan };

const ascending = (left: number, right: number): number => left - right;

const takeFirst = <Row>(rows: readonly Row[]): Row | undefined => rows[0];

// Read the group's stamp, membership and every assertion on its spokes, splitting
// curated provenance from algorithmic so the plan can preserve the former.
const readGroupState = (db: GatewayDb, groupId: number): GroupState | undefined => {
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
	const spokeIds =
		memberTitleIds.length === 0
			? []
			: db
					.select({ id: serviceInstalments.id })
					.from(serviceInstalments)
					.where(inArray(serviceInstalments.titleId, memberTitleIds))
					.all()
					.map((row) => row.id);
	const assertions =
		spokeIds.length === 0
			? []
			: db
					.select()
					.from(instalmentAssertions)
					.where(inArray(instalmentAssertions.instalmentId, spokeIds))
					.all();
	const curated = assertions.filter((row) => isCuratedSource(row.source));
	const algorithmic = assertions.filter((row) => !isCuratedSource(row.source));
	const coveredUnitIds = [...new Set(assertions.map((row) => row.unitId))];
	const absences =
		coveredUnitIds.length === 0
			? []
			: db
					.select()
					.from(absenceAssertions)
					.where(inArray(absenceAssertions.unitId, coveredUnitIds))
					.all();
	const curatedAbsenceIds = absences
		.filter((row) => isCuratedSource(row.source))
		.map((row) => row.id)
		.toSorted(ascending);
	return {
		curatedSpokeIds: new Set(curated.map((row) => row.instalmentId)),
		precondition: {
			algorithmicAssertionIds: algorithmic.map((row) => row.id).toSorted(ascending),
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
const planRecompute = (state: GroupState, input: RecomputeInput): RecomputePlan => {
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

const canonical = (precondition: RecomputePrecondition): string =>
	JSON.stringify(precondition);

// Compare-and-set: re-read the group inside the write and abort untouched if any
// precondition moved since the plan was made. Otherwise drop the algorithmic
// links, write the surviving pairings as fresh units, and restamp the group.
const commitRecompute = (db: GatewayDb, plan: RecomputePlan): RecomputeOutcome =>
	db.transaction((tx): RecomputeOutcome => {
		const current = readGroupState(tx, plan.precondition.groupId);
		if (
			current === undefined ||
			canonical(current.precondition) !== canonical(plan.precondition)
		) {
			return { kind: "aborted" };
		}
		if (plan.deleteAssertionIds.length > 0) {
			tx.delete(instalmentAssertions)
				.where(inArray(instalmentAssertions.id, [...plan.deleteAssertionIds]))
				.run();
		}
		for (const unit of plan.newUnits) {
			const created = takeFirst(tx.insert(contentUnits).values({}).returning().all());
			if (created === undefined) {
				throw new Error("content unit insert returned no row");
			}
			for (const link of unit.links) {
				tx.insert(instalmentAssertions)
					.values({
						confidence: link.confidence,
						instalmentId: link.spokeId,
						source: link.source,
						unitId: created.id,
					})
					.run();
			}
		}
		if (plan.stamp !== undefined) {
			tx.update(titleGroups)
				.set({ ladderComplete: plan.stamp.ladderComplete, source: plan.stamp.source })
				.where(eq(titleGroups.id, plan.precondition.groupId))
				.run();
		}
		return { kind: "applied", plan };
	});

// Read, plan and commit in one pass for callers with no correction window to
// model. The plan and commit stay separate so a caller can interleave reads.
const recomputeGroup = (
	db: GatewayDb,
	input: RecomputeInput,
): RecomputeOutcome => {
	const state = readGroupState(db, input.groupId);
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
