import { createRouterClient } from "@orpc/server";
import { asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
	continuitySegments,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import { ensureGroupContinuity } from "@/engine/continuity/persist";
import type { ORPCContext, SessionUser } from "@/orpc/context";

import { router } from "./index.ts";
import { CreateProposalInput, ProposalIdInput } from "./order-proposals.ts";

const one = <Row>(rows: readonly Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected inserted row");
	}
	return row;
};

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

const seedContinuity = async (
	db: Awaited<ReturnType<typeof freshDb>>,
	count: number,
) => {
	const group = one(
		await db
			.insert(titleGroups)
			.values({ source: "t1-structure" })
			.returning()
			.all(),
	);
	await Promise.all(
		Array.from({ length: count }, async (_ignored, ordinal) =>
			db
				.insert(serviceTitles)
				.values({
					groupId: group.id,
					ordinal,
					service: "tmdb",
					serviceId: `tv:${group.id}-${ordinal + 1}`,
				})
				.run(),
		),
	);
	const continuityId = await ensureGroupContinuity(db, group.id);
	const segments = await db
		.select({ id: continuitySegments.id, titleId: continuitySegments.titleId })
		.from(continuitySegments)
		.where(eq(continuitySegments.continuityId, continuityId))
		.orderBy(asc(continuitySegments.releaseOrdinal))
		.all();
	return { continuityId, segments };
};

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
});
