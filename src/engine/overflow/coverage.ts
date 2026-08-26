import { and, eq } from "drizzle-orm";

import type { Db as CoverageDb } from "@/db";
import { serviceCoverages } from "@/db/engine-schema";
import type { CoverageState } from "@/db/engine-schema";
import type { ContinuityKey } from "@/db/schema.ts";
import type { Service } from "@/engine/identity.ts";

const revisionMatch = (
	continuity: ContinuityKey,
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
	continuity: ContinuityKey,
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
	continuity: ContinuityKey,
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
	continuity: ContinuityKey,
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
	continuity: ContinuityKey,
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

export {
	completeCoverage,
	coverageStateFor,
	coverageStatesFor,
	seedPendingCoverage,
};
