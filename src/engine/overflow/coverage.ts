import { and, eq, inArray } from "drizzle-orm";

import type { Db as CoverageDb } from "@/db";
import { serviceCoverages } from "@/db/engine-schema";
import type { CoverageState } from "@/db/engine-schema";
import { serviceOrder } from "@/engine/identity.ts";
import type { Service } from "@/engine/identity.ts";

type GroupCoverageKey = `group:${number}`;

const groupCoverageKey = (groupId: number): GroupCoverageKey =>
	`group:${groupId}`;

const revisionMatch = (
	continuity: GroupCoverageKey,
	service: Service,
	revision: number,
) =>
	and(
		eq(serviceCoverages.baselineContinuity, continuity),
		eq(serviceCoverages.revision, revision),
		eq(serviceCoverages.targetService, service),
	);

// Before a fan-out begins, every target service gets a `pending` row so a reader
// observes pending, never a partial group. Idempotent: a rerun or a concurrent
// request that seeded first leaves the existing row untouched.
const seedPendingCoverage = async (
	db: CoverageDb,
	continuity: GroupCoverageKey,
	revision: number,
	service: Service,
): Promise<void> => {
	await db
		.insert(serviceCoverages)
		.values({
			baselineContinuity: continuity,
			revision,
			state: "pending",
			targetService: service,
		})
		.onConflictDoNothing()
		.run();
};

// The atomic publication for one target service across the whole continuity: its
// coverage flips to `complete` in a single row write. One service completing
// never waits on another, so an outage elsewhere in the fan-out cannot hide this
// service's verified mappings.
const completeCoverage = async (
	db: CoverageDb,
	continuity: GroupCoverageKey,
	revision: number,
	service: Service,
): Promise<void> => {
	await db
		.insert(serviceCoverages)
		.values({
			baselineContinuity: continuity,
			revision,
			state: "complete",
			targetService: service,
		})
		.onConflictDoUpdate({
			set: { state: "complete" },
			target: [
				serviceCoverages.baselineContinuity,
				serviceCoverages.targetService,
				serviceCoverages.revision,
			],
		})
		.run();
};

const coverageStateFor = async (
	db: CoverageDb,
	continuity: GroupCoverageKey,
	revision: number,
	service: Service,
): Promise<CoverageState | undefined> => {
	const [row] = await db
		.select()
		.from(serviceCoverages)
		.where(revisionMatch(continuity, service, revision))
		.all();
	return row?.state;
};

// How the read side observes a build's progress for one continuity revision: the
// state of each target service. A service still mid-build reads `pending`.
const coverageStatesFor = async (
	db: CoverageDb,
	continuity: GroupCoverageKey,
	revision: number,
): Promise<ReadonlyMap<string, CoverageState>> => {
	const rows = await db
		.select()
		.from(serviceCoverages)
		.where(
			and(
				eq(serviceCoverages.baselineContinuity, continuity),
				eq(serviceCoverages.revision, revision),
			),
		)
		.all();
	return new Map(rows.map((row) => [row.targetService, row.state]));
};

interface MergeCoverageInput {
	readonly retiredGroupIds: readonly number[];
	readonly survivorGroupId: number;
}

// After converge retires loser groups, coverage rows keyed by those group
// continuities would orphan. Do not rename into the survivor (UNIQUE collisions).
// Delete retired keys and seed a fresh pending revision under the survivor so
// overflow rebuilds coverage for every service that had any prior row.
const reconcileCoveragesAfterMerge = async (
	db: CoverageDb,
	input: MergeCoverageInput,
): Promise<void> => {
	if (input.retiredGroupIds.length === 0) {
		return;
	}
	const survivorKey = groupCoverageKey(input.survivorGroupId);
	const retiredKeys = input.retiredGroupIds.map(groupCoverageKey);
	const rows = await db
		.select()
		.from(serviceCoverages)
		.where(
			inArray(serviceCoverages.baselineContinuity, [
				survivorKey,
				...retiredKeys,
			]),
		)
		.all();
	if (rows.length === 0) {
		return;
	}
	await db
		.delete(serviceCoverages)
		.where(inArray(serviceCoverages.baselineContinuity, retiredKeys))
		.run();
	const maxRevisionByService = new Map<Service, number>();
	for (const row of rows) {
		const service = serviceOrder.find(
			(candidate) => candidate === row.targetService,
		);
		if (service === undefined) {
			continue;
		}
		const previous = maxRevisionByService.get(service) ?? 0;
		if (row.revision > previous) {
			maxRevisionByService.set(service, row.revision);
		}
	}
	await Promise.all(
		[...maxRevisionByService].map(async ([service, maxRevision]) =>
			seedPendingCoverage(db, survivorKey, maxRevision + 1, service),
		),
	);
};

export {
	completeCoverage,
	coverageStateFor,
	coverageStatesFor,
	groupCoverageKey,
	reconcileCoveragesAfterMerge,
	seedPendingCoverage,
};
export type { GroupCoverageKey, MergeCoverageInput };
