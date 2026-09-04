import { createRouterClient } from "@orpc/server";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { presentationOrderProposals } from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import type { ORPCContext, SessionUser } from "@/orpc/context";

import { router } from "./index.ts";
import { seedContinuity } from "./order-proposals.seed.ts";
import { CreateProposalInput, ProposalIdInput } from "./order-proposals.ts";

const clientFor = (
	db: Awaited<ReturnType<typeof freshDb>>,
	user: SessionUser | undefined,
) =>
	createRouterClient(router, {
		context: {
			db,
			resolveSession: () => user,
		} satisfies ORPCContext,
	});

const memberUser: SessionUser = { id: "user-1" };
const adminUser: SessionUser = { id: "admin-1", role: "admin" };

describe("orderProposals input boundary", () => {
	it("rejects an empty or duplicate segment list", () => {
		expect(() =>
			CreateProposalInput.parse({
				continuityId: 1,
				name: "Chronological films",
				rationale: "Films between cours",
				segmentIds: [],
			}),
		).toThrow();
		expect(() =>
			CreateProposalInput.parse({
				continuityId: 1,
				name: "Chronological films",
				rationale: "Films between cours",
				segmentIds: [2, 2],
			}),
		).toThrow();
		expect(ProposalIdInput.parse({ proposalId: 3 })).toEqual({
			proposalId: 3,
		});
	});

	it("rejects segment lists over the D1-safe bind cap", () => {
		expect(() =>
			CreateProposalInput.parse({
				continuityId: 1,
				name: "Too many",
				rationale: "Exceeds bind budget",
				segmentIds: Array.from({ length: 34 }, (_ignored, index) => index + 1),
			}),
		).toThrow(/Too big: expected array to have <=33 items/u);
		expect(
			CreateProposalInput.parse({
				continuityId: 1,
				name: "At cap",
				rationale: "Fits bind budget",
				segmentIds: Array.from({ length: 33 }, (_ignored, index) => index + 1),
			}).segmentIds,
		).toHaveLength(33);
	});

	it("creates through the router at the D1-safe cap and rejects over-cap", async () => {
		const db = await freshDb();
		const member = clientFor(db, memberUser);

		const atCap = await seedContinuity(db, 33);
		expect(atCap.segments).toHaveLength(33);
		const atCapIds = atCap.segments.map((segment) => segment.id);
		const created = await member.orderProposals.create({
			continuityId: atCap.continuityId,
			name: "Full continuity order",
			rationale: "Every segment once at the bind cap",
			segmentIds: atCapIds,
		});
		expect(created.items).toHaveLength(33);
		expect(created.items.map((item) => item.segmentId)).toEqual(atCapIds);

		const overCap = await seedContinuity(db, 34);
		expect(overCap.segments).toHaveLength(34);
		const overCapIds = overCap.segments.map((segment) => segment.id);
		await expect(
			member.orderProposals.create({
				continuityId: overCap.continuityId,
				name: "Over cap",
				rationale: "One past the bind budget",
				segmentIds: overCapIds,
			}),
		).rejects.toMatchObject({
			code: "BAD_REQUEST",
			data: {
				issues: [
					expect.objectContaining({
						code: "too_big",
						maximum: 33,
						message: "Too big: expected array to have <=33 items",
						path: ["segmentIds"],
					}),
				],
			},
		});
	});
});

describe("orderProposals authz", () => {
	it("rejects create/list/get for unauthenticated callers", async () => {
		const db = await freshDb();
		const anon = clientFor(db, undefined);
		await expect(
			anon.orderProposals.create({
				continuityId: 1,
				name: "Watch",
				rationale: "Because",
				segmentIds: [1],
			}),
		).rejects.toThrow();
		await expect(
			anon.orderProposals.list({ continuityId: 1 }),
		).rejects.toThrow();
		await expect(anon.orderProposals.get({ proposalId: 1 })).rejects.toThrow();
	});

	it("rejects accept for unauthenticated and non-admin callers", async () => {
		const db = await freshDb();
		const { continuityId, segments } = await seedContinuity(db, 2);
		const [first, second] = segments;
		if (first === undefined || second === undefined) {
			throw new Error("expected two segments");
		}
		const member = clientFor(db, memberUser);
		const created = await member.orderProposals.create({
			continuityId,
			name: "Film-forward",
			rationale: "Lead with the theatrical cut",
			segmentIds: [second.id, first.id],
		});

		await expect(
			clientFor(db, undefined).orderProposals.accept({
				proposalId: created.id,
			}),
		).rejects.toThrow();
		await expect(
			member.orderProposals.accept({ proposalId: created.id }),
		).rejects.toThrow();
	});
});

describe("orderProposals happy path", () => {
	it("creates, lists, and gets a pending proposal", async () => {
		const db = await freshDb();
		const { continuityId, segments } = await seedContinuity(db, 3);
		const [first, second, third] = segments;
		if (first === undefined || second === undefined || third === undefined) {
			throw new Error("expected three segments");
		}
		const member = clientFor(db, memberUser);
		const ordered = [third.id, first.id, second.id];

		const created = await member.orderProposals.create({
			continuityId,
			name: "Theatrical insert",
			rationale: "Place the film after cours one",
			segmentIds: ordered,
		});
		expect(created).toMatchObject({
			authorUserId: memberUser.id,
			continuityId,
			name: "Theatrical insert",
			status: "pending",
		});
		expect(created.items.map((item) => item.segmentId)).toEqual(ordered);

		const storedAuthor = await db
			.select({ authorUserId: presentationOrderProposals.authorUserId })
			.from(presentationOrderProposals)
			.where(eq(presentationOrderProposals.id, created.id))
			.get();
		expect(storedAuthor?.authorUserId).toBe(memberUser.id);

		const listed = await member.orderProposals.list({ continuityId });
		expect(listed).toHaveLength(1);
		expect(listed[0]?.id).toBe(created.id);

		const fetched = await member.orderProposals.get({
			proposalId: created.id,
		});
		expect(fetched.items.map((item) => item.position)).toEqual([0, 1, 2]);
	});

	it("accepts a pending proposal and blocks a second review", async () => {
		const db = await freshDb();
		const { continuityId, segments } = await seedContinuity(db, 2);
		const [first, second] = segments;
		if (first === undefined || second === undefined) {
			throw new Error("expected two segments");
		}
		const member = clientFor(db, memberUser);
		const admin = clientFor(db, adminUser);
		const created = await member.orderProposals.create({
			continuityId,
			name: "Film-forward",
			rationale: "Lead with the theatrical cut",
			segmentIds: [second.id, first.id],
		});

		const accepted = await admin.orderProposals.accept({
			proposalId: created.id,
		});
		expect(accepted.status).toBe("accepted");
		expect(accepted.reviewedByUserId).toBe(adminUser.id);
		expect(accepted.reviewedAt).toBeInstanceOf(Date);

		await expect(
			admin.orderProposals.reject({ proposalId: created.id }),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("rejects an incomplete segment set on create", async () => {
		const db = await freshDb();
		const { continuityId, segments } = await seedContinuity(db, 2);
		const [first] = segments;
		if (first === undefined) {
			throw new Error("expected a segment");
		}
		const member = clientFor(db, memberUser);
		await expect(
			member.orderProposals.create({
				continuityId,
				name: "Partial",
				rationale: "Missing a continuity segment",
				segmentIds: [first.id],
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("rejects a foreign segment on create", async () => {
		const db = await freshDb();
		const first = await seedContinuity(db, 1);
		const second = await seedContinuity(db, 1);
		const [foreign] = second.segments;
		if (foreign === undefined) {
			throw new Error("expected a foreign segment");
		}
		const member = clientFor(db, memberUser);
		await expect(
			member.orderProposals.create({
				continuityId: first.continuityId,
				name: "Bad mix",
				rationale: "Wrong continuity segments",
				segmentIds: [foreign.id],
			}),
		).rejects.toMatchObject({ code: "BAD_REQUEST" });
	});

	it("retains orphan author and reviewer ids after auth user deletion", async () => {
		const db = await freshDb();
		const { continuityId, segments } = await seedContinuity(db, 2);
		const [first, second] = segments;
		if (first === undefined || second === undefined) {
			throw new Error("expected two segments");
		}
		const member = clientFor(db, memberUser);
		const admin = clientFor(db, adminUser);
		const created = await member.orderProposals.create({
			continuityId,
			name: "Audit retain",
			rationale: "Historical ids survive user deletion",
			segmentIds: [second.id, first.id],
		});
		await admin.orderProposals.accept({ proposalId: created.id });

		const orphanAuthorId = "deleted-author";
		const orphanReviewerId = "deleted-reviewer";
		await db
			.update(presentationOrderProposals)
			.set({
				authorUserId: orphanAuthorId,
				reviewedByUserId: orphanReviewerId,
			})
			.where(eq(presentationOrderProposals.id, created.id));

		const fetched = await member.orderProposals.get({
			proposalId: created.id,
		});
		expect(fetched).toMatchObject({
			authorUserId: orphanAuthorId,
			reviewedByUserId: orphanReviewerId,
			status: "accepted",
		});
	});
});
