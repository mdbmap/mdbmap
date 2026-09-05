import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { titleAssertions } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";

import type { EscalationReason } from "./review.ts";
import { reviewResearchProposal } from "./task.ts";
import type { ReviewTaskDeps } from "./task.ts";
import { ascendingPair, one, seedTitle } from "./test-fixtures.ts";
import type { TestDb as Db } from "./test-fixtures.ts";
import type { ReviewProposal } from "./types.ts";

const seedProposal = async (db: Db): Promise<ReviewProposal> => {
	const left = await seedTitle(db, "tmdb", "1396");
	const right = await seedTitle(db, "tvdb", "81189");
	const [lowId, highId] = ascendingPair(left.id, right.id);
	const assertion = one(
		await db
			.insert(titleAssertions)
			.values({
				confidence: "low",
				source: "llm-research",
				titleAId: lowId,
				titleBId: highId,
			})
			.returning()
			.all(),
	);
	return {
		assertionId: assertion.id,
		claim: "tmdb:1396 and tvdb:81189 are the same title",
		evidence: [
			{
				kind: "api",
				operator: "tvdb",
				summary: "TVDB confirms the same run",
				url: "https://api.thetvdb.com/series/81189",
			},
		],
		kind: "title",
	};
};

const readSource = async (db: Db, assertionId: number): Promise<string> =>
	one(
		await db
			.select()
			.from(titleAssertions)
			.where(eq(titleAssertions.id, assertionId))
			.all(),
	).source;

interface Escalation {
	readonly proposal: ReviewProposal;
	readonly rationale: string | undefined;
	readonly reason: EscalationReason;
}

const deps = (
	db: Db,
	verdict: unknown,
	escalations: Escalation[],
): ReviewTaskDeps => ({
	db,
	escalate: (proposal, reason, rationale) => {
		escalations.push({ proposal, rationale, reason });
	},
	judge: () => verdict,
});

describe("reviewResearchProposal", () => {
	let db: Db;

	beforeEach(async () => {
		db = await freshDb();
	});

	it("promotes the assertion on a supporting verdict and never escalates", async () => {
		const proposal = await seedProposal(db);
		const escalations: Escalation[] = [];
		const result = await reviewResearchProposal(
			proposal,
			deps(
				db,
				{ rationale: "both sides agree", verdict: "supporting" },
				escalations,
			),
		);
		expect(result).toEqual({ kind: "promoted" });
		expect(await readSource(db, proposal.assertionId)).toBe("llm-verified");
		expect(escalations).toEqual([]);
	});

	it("escalates a disputing verdict and leaves the assertion unpromoted", async () => {
		const proposal = await seedProposal(db);
		const escalations: Escalation[] = [];
		const result = await reviewResearchProposal(
			proposal,
			deps(
				db,
				{ rationale: "counts disagree", verdict: "disputing" },
				escalations,
			),
		);
		expect(result).toEqual({
			kind: "escalated",
			rationale: "counts disagree",
			reason: "disputing",
		});
		expect(await readSource(db, proposal.assertionId)).toBe("llm-research");
		expect(escalations).toEqual([
			{ proposal, rationale: "counts disagree", reason: "disputing" },
		]);
	});

	it("escalates an unable-to-tell verdict and leaves the assertion unpromoted", async () => {
		const proposal = await seedProposal(db);
		const escalations: Escalation[] = [];
		const result = await reviewResearchProposal(
			proposal,
			deps(
				db,
				{ rationale: "not enough evidence", verdict: "unable-to-tell" },
				escalations,
			),
		);
		expect(result).toEqual({
			kind: "escalated",
			rationale: "not enough evidence",
			reason: "unable-to-tell",
		});
		expect(await readSource(db, proposal.assertionId)).toBe("llm-research");
		expect(escalations).toEqual([
			{
				proposal,
				rationale: "not enough evidence",
				reason: "unable-to-tell",
			},
		]);
	});

	it("escalates malformed model output and leaves the assertion unpromoted", async () => {
		const proposal = await seedProposal(db);
		const escalations: Escalation[] = [];
		const result = await reviewResearchProposal(
			proposal,
			deps(db, { verdict: "yes please" }, escalations),
		);
		expect(result).toEqual({
			kind: "escalated",
			rationale: undefined,
			reason: "malformed-output",
		});
		expect(await readSource(db, proposal.assertionId)).toBe("llm-research");
		expect(escalations).toEqual([
			{ proposal, rationale: undefined, reason: "malformed-output" },
		]);
	});

	it("reports stale instead of promoting a row a concurrent writer already moved", async () => {
		const proposal = await seedProposal(db);
		await db
			.update(titleAssertions)
			.set({ source: "manual" })
			.where(eq(titleAssertions.id, proposal.assertionId))
			.run();
		const escalations: Escalation[] = [];
		const result = await reviewResearchProposal(
			proposal,
			deps(
				db,
				{ rationale: "both sides agree", verdict: "supporting" },
				escalations,
			),
		);
		expect(result).toEqual({ kind: "stale" });
		expect(await readSource(db, proposal.assertionId)).toBe("manual");
	});

	it("escalates a supporting verdict for a missing assertion", async () => {
		const proposal = {
			...(await seedProposal(db)),
			assertionId: 999_999,
		};
		const escalations: Escalation[] = [];
		const result = await reviewResearchProposal(
			proposal,
			deps(
				db,
				{ rationale: "both sides agree", verdict: "supporting" },
				escalations,
			),
		);
		expect(result).toEqual({
			kind: "escalated",
			rationale: "both sides agree",
			reason: "missing-assertion",
		});
		expect(escalations).toEqual([
			{
				proposal,
				rationale: "both sides agree",
				reason: "missing-assertion",
			},
		]);
	});
});
