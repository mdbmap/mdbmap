import { and, eq } from "drizzle-orm";

import type { Db } from "@/db";
import {
	instalmentAssertions,
	relationAssertions,
	titleAssertions,
} from "@/db/engine-schema";

import type { ProposalKind } from "./types.ts";

type PromoteResult = "already-moved" | "missing" | "promoted";

const RESEARCH = "llm-research" as const;
const VERIFIED = "llm-verified" as const;

const assertionTables = {
	instalment: instalmentAssertions,
	relation: relationAssertions,
	title: titleAssertions,
} as const satisfies Record<
	ProposalKind,
	| typeof instalmentAssertions
	| typeof relationAssertions
	| typeof titleAssertions
>;

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
	const table = assertionTables[kind];
	const result = await db
		.update(table)
		.set({ source: VERIFIED })
		.where(and(eq(table.id, assertionId), eq(table.source, RESEARCH)))
		.run();
	if (result.meta.changes > 0) {
		return "promoted";
	}

	const existing = await db
		.select({ id: table.id })
		.from(table)
		.where(eq(table.id, assertionId))
		.get();
	return existing === undefined ? "missing" : "already-moved";
};

export { promoteAssertion };
export type { PromoteResult };
