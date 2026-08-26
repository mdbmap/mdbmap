import { and, eq } from "drizzle-orm";

import type { Db } from "@/db";
import {
	instalmentAssertions,
	relationAssertions,
	titleAssertions,
} from "@/db/engine-schema";

import type { ProposalKind } from "./types.ts";

type PromoteResult = "already-moved" | "promoted";

const RESEARCH = "llm-research" as const;
const VERIFIED = "llm-verified" as const;

// One D1 UPDATE per table, each conditioned on the row still carrying
// `llm-research` so the caller learns whether its own promote applied.
const promoteRow = async (
	db: Db,
	kind: ProposalKind,
	assertionId: number,
): Promise<number> => {
	switch (kind) {
		case "instalment": {
			const result = await db
				.update(instalmentAssertions)
				.set({ source: VERIFIED })
				.where(
					and(
						eq(instalmentAssertions.id, assertionId),
						eq(instalmentAssertions.source, RESEARCH),
					),
				)
				.run();
			return result.meta.changes;
		}
		case "relation": {
			const result = await db
				.update(relationAssertions)
				.set({ source: VERIFIED })
				.where(
					and(
						eq(relationAssertions.id, assertionId),
						eq(relationAssertions.source, RESEARCH),
					),
				)
				.run();
			return result.meta.changes;
		}
		case "title": {
			const result = await db
				.update(titleAssertions)
				.set({ source: VERIFIED })
				.where(
					and(
						eq(titleAssertions.id, assertionId),
						eq(titleAssertions.source, RESEARCH),
					),
				)
				.run();
			return result.meta.changes;
		}
	}
};

// CAS the assertion's provenance from `llm-research` to `llm-verified` — epic
// #28's derived source precedence already ranks the latter above the former,
// so promoting is exactly this in-place rewrite. The conditional UPDATE is one
// atomic SQLite statement, so a row a concurrent write already moved (or that
// never carried `llm-research`) is reported rather than silently reapplied.
const promoteAssertion = async (
	db: Db,
	kind: ProposalKind,
	assertionId: number,
): Promise<PromoteResult> => {
	const changes = await promoteRow(db, kind, assertionId);
	return changes > 0 ? "promoted" : "already-moved";
};

export { promoteAssertion };
export type { PromoteResult };
