import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
	contentUnits,
	instalmentAssertions,
	pendingGroupCandidates,
	serviceInstalments,
	serviceTitles,
	titleGroupAliases,
	titleGroups,
} from "@/db/engine-schema";
import type { CandidateEvidence, CandidateSubject } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import type { GatewayDb } from "@/engine/gateway";

import {
	acceptMembership,
	clearReviewFlag,
	keepReviewFlag,
	listOpenCandidates,
	manualPairing,
	markAsMatched,
	publicationStatus,
	queueAssertionConflict,
	settleConflict,
} from "./index.ts";

const first = <Row>(rows: readonly Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected a row");
	}
	return row;
};

const makeGroup = (db: GatewayDb, source = "t1-structure" as const): number =>
	first(db.insert(titleGroups).values({ source }).returning().all()).id;

const makeTitle = (
	db: GatewayDb,
	groupId: number,
	service: string,
	serviceId: string,
	ordinal = 0,
): number =>
	first(
		db
			.insert(serviceTitles)
			.values({ groupId, ordinal, service, serviceId })
			.returning()
			.all(),
	).id;

const makeSpoke = (db: GatewayDb, titleId: number, locator: string): number =>
	first(
		db
			.insert(serviceInstalments)
			.values({ locator, locatorKind: "service-id", titleId })
			.returning()
			.all(),
	).id;

const makeUnit = (db: GatewayDb): number =>
	first(db.insert(contentUnits).values({}).returning().all()).id;

const groupSourceOf = (db: GatewayDb, groupId: number): string => {
	const group = first(
		db.select().from(titleGroups).where(eq(titleGroups.id, groupId)).all(),
	);
	return group.source;
};

const openRows = (db: GatewayDb) => listOpenCandidates(db);

describe("moderation queue", () => {
	it("blocks a group's publication on a queued instalment conflict and shows both proposals", () => {
		const db = freshDb();
		const groupId = makeGroup(db);
		const titleId = makeTitle(db, groupId, "tmdb", "1396");
		const spokeId = makeSpoke(db, titleId, "1:1");
		const proposedUnit = makeUnit(db);
		const publishedUnit = makeUnit(db);

		const subject: CandidateSubject = { subjectType: "title", titleId };
		const evidence: CandidateEvidence = {
			instalmentId: spokeId,
			kind: "instalment-assertion-conflict",
			proposed: { confidence: "high", source: "t3-episode", unitId: proposedUnit },
			published: { confidence: "high", source: "t1-structure", unitId: publishedUnit },
		};
		const queued = queueAssertionConflict(db, { evidence, subject });
		expect(queued.kind).toBe("queued");

		const status = publicationStatus(db, groupId);
		expect(status.blocked).toBe(true);
		expect(status.conflicts).toHaveLength(1);
		const conflict = first(status.conflicts).evidence;
		expect(conflict.kind).toBe("instalment-assertion-conflict");
		if (conflict.kind === "instalment-assertion-conflict") {
			expect(conflict.proposed.unitId).toBe(proposedUnit);
			expect(conflict.published?.unitId).toBe(publishedUnit);
		}
	});

	it("does not block a group with no open conflict", () => {
		const db = freshDb();
		const groupId = makeGroup(db);
		makeTitle(db, groupId, "tmdb", "1396");
		expect(publicationStatus(db, groupId).blocked).toBe(false);
	});

	it("accepts a fuzzy membership candidate through the curated path and stamps manual", () => {
		const db = freshDb();
		const groupId = makeGroup(db, "t1-structure");
		const subjectTitleId = makeTitle(db, groupId, "tmdb", "1396");

		const subject: CandidateSubject = { subjectType: "title", titleId: subjectTitleId };
		const evidence: CandidateEvidence = {
			alsoConsidered: [],
			kind: "fuzzy-group",
			overCap: [],
			proposedMembers: [
				{ score: 0.95, service: "imdb", serviceId: "tt0903747", title: "Breaking Bad", year: 2008 },
			],
			queries: [{ service: "imdb", title: "Breaking Bad", year: 2008 }],
		};
		const candidateId = first(
			db
				.insert(pendingGroupCandidates)
				.values({
					evidence,
					evidenceHash: `fuzzy-group:${JSON.stringify([["imdb", "tt0903747"]])}`,
					kind: "fuzzy-group",
					subject,
					subjectKey: `title:${subjectTitleId}`,
				})
				.returning()
				.all(),
		).id;

		const outcome = acceptMembership(db, candidateId);
		expect(outcome.kind).toBe("accepted");

		const attached = db
			.select()
			.from(serviceTitles)
			.where(eq(serviceTitles.serviceId, "tt0903747"))
			.all();
		expect(attached).toHaveLength(1);
		expect(first(attached).groupId).toBe(groupId);

		const group = first(db.select().from(titleGroups).where(eq(titleGroups.id, groupId)).all());
		expect(group.source).toBe("manual");
		expect(openRows(db)).toHaveLength(0);
	});

	it("merges competing groups when a structural candidate is accepted", () => {
		const db = freshDb();
		const groupA = makeGroup(db);
		const groupB = makeGroup(db);
		const titleA = makeTitle(db, groupA, "tmdb", "1396");
		const titleB = makeTitle(db, groupB, "imdb", "tt0903747");
		const survivor = Math.min(groupA, groupB);
		const retired = Math.max(groupA, groupB);

		const subject: CandidateSubject = { subjectType: "title", titleId: Math.min(titleA, titleB) };
		const evidence: CandidateEvidence = {
			competingGroupIds: [groupA, groupB],
			kind: "structural",
			proposedMembers: [
				{ service: "tmdb", serviceId: "1396" },
				{ service: "imdb", serviceId: "tt0903747" },
			],
		};
		const candidateId = first(
			db
				.insert(pendingGroupCandidates)
				.values({
					evidence,
					evidenceHash: "structural:test",
					kind: "structural",
					subject,
					subjectKey: `title:${Math.min(titleA, titleB)}`,
				})
				.returning()
				.all(),
		).id;

		expect(acceptMembership(db, candidateId).kind).toBe("accepted");

		const members = db.select().from(serviceTitles).all();
		expect(members.every((member) => member.groupId === survivor)).toBe(true);
		const alias = db
			.select()
			.from(titleGroupAliases)
			.where(eq(titleGroupAliases.retiredGroupId, retired))
			.all();
		expect(first(alias).survivorGroupId).toBe(survivor);
		expect(groupSourceOf(db, survivor)).toBe("manual");
	});

	it("clears a review flag, keeping the link but dropping it from the queue", () => {
		const db = freshDb();
		const groupId = makeGroup(db);
		const titleId = makeTitle(db, groupId, "tmdb", "1396");
		const spokeId = makeSpoke(db, titleId, "1:1");
		const unitId = makeUnit(db);
		const assertionId = first(
			db
				.insert(instalmentAssertions)
				.values({ confidence: "low", instalmentId: spokeId, source: "t3-episode", unitId })
				.returning()
				.all(),
		).id;

		const subject: CandidateSubject = { subjectType: "title", titleId };
		const evidence: CandidateEvidence = {
			confidence: "low",
			instalmentId: spokeId,
			kind: "low-confidence-flag",
			source: "t3-episode",
			unitId,
		};
		const candidateId = first(
			db
				.insert(pendingGroupCandidates)
				.values({
					evidence,
					evidenceHash: `low-confidence-flag:${spokeId}`,
					kind: "low-confidence-flag",
					subject,
					subjectKey: `title:${titleId}`,
				})
				.returning()
				.all(),
		).id;

		expect(clearReviewFlag(db, candidateId).kind).toBe("cleared");

		const link = db
			.select()
			.from(instalmentAssertions)
			.where(eq(instalmentAssertions.id, assertionId))
			.all();
		expect(link).toHaveLength(1);
		expect(openRows(db)).toHaveLength(0);
	});

	it("keeps a review flag open in the queue", () => {
		const db = freshDb();
		const groupId = makeGroup(db);
		const titleId = makeTitle(db, groupId, "tmdb", "1396");
		const spokeId = makeSpoke(db, titleId, "1:1");
		const unitId = makeUnit(db);

		const subject: CandidateSubject = { subjectType: "title", titleId };
		const evidence: CandidateEvidence = {
			confidence: "low",
			instalmentId: spokeId,
			kind: "low-confidence-flag",
			source: "t3-episode",
			unitId,
		};
		const candidateId = first(
			db
				.insert(pendingGroupCandidates)
				.values({
					evidence,
					evidenceHash: `low-confidence-flag:${spokeId}`,
					kind: "low-confidence-flag",
					subject,
					subjectKey: `title:${titleId}`,
				})
				.returning()
				.all(),
		).id;

		expect(keepReviewFlag(db, candidateId).kind).toBe("kept");
		expect(openRows(db)).toHaveLength(1);
	});

	it("auto-rejects a competing proposal when a prior manual assertion stands", () => {
		const db = freshDb();
		const groupId = makeGroup(db);
		const titleId = makeTitle(db, groupId, "tmdb", "1396");
		const spokeId = makeSpoke(db, titleId, "1:1");
		const manualUnit = makeUnit(db);
		const competingUnit = makeUnit(db);
		db.insert(instalmentAssertions)
			.values({ confidence: "high", instalmentId: spokeId, source: "manual", unitId: manualUnit })
			.run();

		const subject: CandidateSubject = { subjectType: "title", titleId };
		const evidence: CandidateEvidence = {
			instalmentId: spokeId,
			kind: "instalment-assertion-conflict",
			proposed: { confidence: "high", source: "t3-episode", unitId: competingUnit },
			published: { confidence: "high", source: "manual", unitId: manualUnit },
		};
		const outcome = queueAssertionConflict(db, { evidence, subject });
		expect(outcome.kind).toBe("auto-rejected");
		expect(openRows(db)).toHaveLength(0);
		expect(publicationStatus(db, groupId).blocked).toBe(false);
	});

	it("settles an instalment conflict by publishing the proposed side as manual", () => {
		const db = freshDb();
		const groupId = makeGroup(db);
		const titleId = makeTitle(db, groupId, "tmdb", "1396");
		const spokeId = makeSpoke(db, titleId, "1:1");
		const proposedUnit = makeUnit(db);

		const subject: CandidateSubject = { subjectType: "title", titleId };
		const evidence: CandidateEvidence = {
			instalmentId: spokeId,
			kind: "instalment-assertion-conflict",
			proposed: { confidence: "high", source: "t3-episode", unitId: proposedUnit },
			published: { confidence: "high", source: "t1-structure", unitId: makeUnit(db) },
		};
		const candidateId = queueAssertionConflict(db, { evidence, subject }).candidateId ?? 0;

		expect(settleConflict(db, { accept: true, candidateId }).kind).toBe("settled");
		const links = db
			.select()
			.from(instalmentAssertions)
			.where(eq(instalmentAssertions.instalmentId, spokeId))
			.all();
		expect(links.some((link) => link.source === "manual" && link.unitId === proposedUnit)).toBe(true);
		expect(openRows(db)).toHaveLength(0);
	});

	it("does not close a conflict as accepted when the proposed assertion already exists", () => {
		const db = freshDb();
		const groupId = makeGroup(db);
		const titleId = makeTitle(db, groupId, "tmdb", "1396");
		const spokeId = makeSpoke(db, titleId, "1:1");
		const proposedUnit = makeUnit(db);
		// A non-manual assertion already occupies the proposed edge, so the accept
		// insert collides on instalment_assertions_instalment_unit_idx.
		db.insert(instalmentAssertions)
			.values({ confidence: "high", instalmentId: spokeId, source: "t3-episode", unitId: proposedUnit })
			.run();

		const subject: CandidateSubject = { subjectType: "title", titleId };
		const evidence: CandidateEvidence = {
			instalmentId: spokeId,
			kind: "instalment-assertion-conflict",
			proposed: { confidence: "high", source: "t3-episode", unitId: proposedUnit },
			published: { confidence: "high", source: "t1-structure", unitId: makeUnit(db) },
		};
		const candidateId = queueAssertionConflict(db, { evidence, subject }).candidateId ?? 0;

		expect(settleConflict(db, { accept: true, candidateId }).kind).toBe("collision");
		expect(openRows(db)).toHaveLength(1);
	});

	it("pairs instalments by hand onto one content unit as manual", () => {
		const db = freshDb();
		const groupId = makeGroup(db);
		const titleA = makeTitle(db, groupId, "tmdb", "1396");
		const titleB = makeTitle(db, groupId, "imdb", "tt0903747", 1);
		const spokeA = makeSpoke(db, titleA, "1:1");
		const spokeB = makeSpoke(db, titleB, "1:1");

		const outcome = manualPairing(db, { instalmentIds: [spokeA, spokeB] });
		expect(outcome.kind).toBe("paired");
		const links = db.select().from(instalmentAssertions).all();
		expect(links).toHaveLength(2);
		expect(links.every((link) => link.source === "manual")).toBe(true);
		expect(new Set(links.map((link) => link.unitId)).size).toBe(1);
	});

	it("marks a group as matched with a manual vouch", () => {
		const db = freshDb();
		const groupId = makeGroup(db);
		expect(markAsMatched(db, groupId).kind).toBe("matched");
		expect(groupSourceOf(db, groupId)).toBe("manual");
	});
});
