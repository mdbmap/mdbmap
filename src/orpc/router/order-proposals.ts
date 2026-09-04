import { ORPCError } from "@orpc/server";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import type { presentationOrderProposalStatuses } from "@/db/engine-schema";
import {
	continuities,
	continuitySegments,
	presentationOrderProposalItems,
	presentationOrderProposals,
} from "@/db/engine-schema";
import { admin, authed } from "@/orpc/base";
import type { Db } from "@/orpc/context";

interface ProposalItemView {
	readonly position: number;
	readonly segmentId: number;
}

interface ProposalView {
	readonly authorUserId: string;
	readonly continuityId: number;
	readonly createdAt: Date;
	readonly id: number;
	readonly items: readonly ProposalItemView[];
	readonly name: string;
	readonly rationale: string;
	readonly reviewedAt?: Date;
	readonly reviewedByUserId?: string;
	readonly status: (typeof presentationOrderProposalStatuses)[number];
	readonly updatedAt: Date;
}

interface ProposalRow {
	readonly authorUserId: string;
	readonly continuityId: number;
	readonly createdAt: Date;
	readonly id: number;
	readonly name: string;
	readonly rationale: string;
	readonly reviewedAt: Date | null;
	readonly reviewedByUserId: string | null;
	readonly status: (typeof presentationOrderProposalStatuses)[number];
	readonly updatedAt: Date;
}

const uniqueSegmentIds = (ids: readonly number[]): boolean =>
	new Set(ids).size === ids.length;

const CreateProposalInput = z.object({
	continuityId: z.number().int().min(1),
	name: z.string().trim().min(1).max(120),
	rationale: z.string().trim().min(1).max(2000),
	segmentIds: z
		.array(z.number().int().min(1))
		.min(1)
		.max(33)
		.refine(uniqueSegmentIds, {
			message: "Proposal segment ids must be unique",
		}),
});

const ContinuityIdInput = z.object({
	continuityId: z.number().int().min(1),
});

const ProposalIdInput = z.object({
	proposalId: z.number().int().min(1),
});

const requireContinuity = async (
	db: Db,
	continuityId: number,
): Promise<void> => {
	const row = await db
		.select({ id: continuities.id })
		.from(continuities)
		.where(eq(continuities.id, continuityId))
		.get();
	if (row === undefined) {
		throw new ORPCError("NOT_FOUND", {
			message: "Continuity not found.",
		});
	}
};

const assertSegmentsForContinuity = async (
	db: Db,
	continuityId: number,
	segmentIds: readonly number[],
): Promise<void> => {
	const chunkSize = 100;
	const chunks = Array.from(
		{ length: Math.ceil(segmentIds.length / chunkSize) },
		(_ignored, index) =>
			segmentIds.slice(index * chunkSize, (index + 1) * chunkSize),
	);
	const chunkRows = await Promise.all(
		chunks.map(async (chunk) =>
			db
				.select({
					continuityId: continuitySegments.continuityId,
					id: continuitySegments.id,
				})
				.from(continuitySegments)
				.where(inArray(continuitySegments.id, [...chunk]))
				.all(),
		),
	);
	const byId = new Map(
		chunkRows.flat().map((row) => [row.id, row.continuityId]),
	);
	if (segmentIds.some((segmentId) => byId.get(segmentId) !== continuityId)) {
		throw new ORPCError("BAD_REQUEST", {
			message: "Proposal segment does not belong to continuity.",
		});
	}
};

const itemsFor = async (
	db: Db,
	proposalId: number,
): Promise<readonly ProposalItemView[]> =>
	db
		.select({
			position: presentationOrderProposalItems.position,
			segmentId: presentationOrderProposalItems.segmentId,
		})
		.from(presentationOrderProposalItems)
		.where(eq(presentationOrderProposalItems.proposalId, proposalId))
		.orderBy(asc(presentationOrderProposalItems.position))
		.all();

const itemsForMany = async (
	db: Db,
	proposalIds: readonly number[],
): Promise<ReadonlyMap<number, readonly ProposalItemView[]>> => {
	if (proposalIds.length === 0) {
		return new Map();
	}
	const chunkSize = 100;
	const chunks = Array.from(
		{ length: Math.ceil(proposalIds.length / chunkSize) },
		(_ignored, index) =>
			proposalIds.slice(index * chunkSize, (index + 1) * chunkSize),
	);
	const chunkRows = await Promise.all(
		chunks.map(async (chunk) =>
			db
				.select({
					position: presentationOrderProposalItems.position,
					proposalId: presentationOrderProposalItems.proposalId,
					segmentId: presentationOrderProposalItems.segmentId,
				})
				.from(presentationOrderProposalItems)
				.where(inArray(presentationOrderProposalItems.proposalId, [...chunk]))
				.orderBy(
					asc(presentationOrderProposalItems.proposalId),
					asc(presentationOrderProposalItems.position),
				)
				.all(),
		),
	);
	const byProposal = new Map<number, ProposalItemView[]>();
	for (const rows of chunkRows) {
		for (const row of rows) {
			const items = byProposal.get(row.proposalId) ?? [];
			items.push({ position: row.position, segmentId: row.segmentId });
			byProposal.set(row.proposalId, items);
		}
	}
	return byProposal;
};

const toView = (
	row: ProposalRow,
	items: readonly ProposalItemView[],
): ProposalView => {
	const view: ProposalView = {
		authorUserId: row.authorUserId,
		continuityId: row.continuityId,
		createdAt: row.createdAt,
		id: row.id,
		items,
		name: row.name,
		rationale: row.rationale,
		status: row.status,
		updatedAt: row.updatedAt,
	};
	if (row.reviewedAt === null) {
		return view;
	}
	return {
		...view,
		reviewedAt: row.reviewedAt,
		...(row.reviewedByUserId === null
			? {}
			: { reviewedByUserId: row.reviewedByUserId }),
	};
};

const loadProposal = async (
	db: Db,
	proposalId: number,
): Promise<ProposalView> => {
	const row = await db
		.select()
		.from(presentationOrderProposals)
		.where(eq(presentationOrderProposals.id, proposalId))
		.get();
	if (row === undefined) {
		throw new ORPCError("NOT_FOUND", {
			message: "Proposal not found.",
		});
	}
	return toView(row, await itemsFor(db, row.id));
};

const insertProposalId = (results: D1Result[]): number => {
	const [proposalResult] = results;
	const [row] = proposalResult?.results ?? [];
	if (
		typeof row !== "object" ||
		row === null ||
		!("id" in row) ||
		typeof row.id !== "number"
	) {
		throw new ORPCError("INTERNAL_SERVER_ERROR", {
			message: "Failed to create proposal.",
		});
	}
	return row.id;
};

const create = authed
	.input(CreateProposalInput)
	.handler(async ({ context, input }): Promise<ProposalView> => {
		await requireContinuity(context.db, input.continuityId);
		await assertSegmentsForContinuity(
			context.db,
			input.continuityId,
			input.segmentIds,
		);
		const itemValues = input.segmentIds.map(() => "(?, ?)").join(", ");
		const itemBinds = input.segmentIds.flatMap((segmentId, position) => [
			position,
			segmentId,
		]);
		const proposalId = insertProposalId(
			await context.db.$client.batch([
				context.db.$client
					.prepare(
						`INSERT INTO presentation_order_proposals
							(author_user_id, continuity_id, name, rationale, status)
						 VALUES (?, ?, ?, ?, 'pending')
						 RETURNING id`,
					)
					.bind(
						context.user.id,
						input.continuityId,
						input.name,
						input.rationale,
					),
				context.db.$client
					.prepare(
						`INSERT INTO presentation_order_proposal_items
							(proposal_id, position, segment_id)
						 SELECT p.proposal_id, v.column1, v.column2
						 FROM (SELECT last_insert_rowid() AS proposal_id) AS p,
						      (VALUES ${itemValues}) AS v`,
					)
					.bind(...itemBinds),
			]),
		);
		return loadProposal(context.db, proposalId);
	});

const list = authed
	.input(ContinuityIdInput)
	.handler(async ({ context, input }): Promise<readonly ProposalView[]> => {
		await requireContinuity(context.db, input.continuityId);
		const rows = await context.db
			.select()
			.from(presentationOrderProposals)
			.where(eq(presentationOrderProposals.continuityId, input.continuityId))
			.orderBy(asc(presentationOrderProposals.id))
			.all();
		const itemsByProposal = await itemsForMany(
			context.db,
			rows.map((row) => row.id),
		);
		return rows.map((row) => toView(row, itemsByProposal.get(row.id) ?? []));
	});

const get = authed
	.input(ProposalIdInput)
	.handler(async ({ context, input }): Promise<ProposalView> =>
		loadProposal(context.db, input.proposalId),
	);

const review = async (
	db: Db,
	proposalId: number,
	reviewerUserId: string,
	status: "accepted" | "rejected",
): Promise<ProposalView> => {
	const existing = await db
		.select({
			id: presentationOrderProposals.id,
			status: presentationOrderProposals.status,
		})
		.from(presentationOrderProposals)
		.where(eq(presentationOrderProposals.id, proposalId))
		.get();
	if (existing === undefined) {
		throw new ORPCError("NOT_FOUND", {
			message: "Proposal not found.",
		});
	}
	if (existing.status !== "pending") {
		throw new ORPCError("BAD_REQUEST", {
			message: "Only pending proposals can be reviewed.",
		});
	}
	const updated = await db
		.update(presentationOrderProposals)
		.set({
			reviewedAt: new Date(),
			reviewedByUserId: reviewerUserId,
			status,
		})
		.where(
			and(
				eq(presentationOrderProposals.id, proposalId),
				eq(presentationOrderProposals.status, "pending"),
			),
		)
		.returning({ id: presentationOrderProposals.id })
		.all();
	if (updated.length === 0) {
		throw new ORPCError("CONFLICT", {
			message: "Proposal was already reviewed.",
		});
	}
	return loadProposal(db, proposalId);
};

const accept = admin
	.input(ProposalIdInput)
	.handler(async ({ context, input }): Promise<ProposalView> =>
		review(context.db, input.proposalId, context.user.id, "accepted"),
	);

const reject = admin
	.input(ProposalIdInput)
	.handler(async ({ context, input }): Promise<ProposalView> =>
		review(context.db, input.proposalId, context.user.id, "rejected"),
	);

const orderProposals = { accept, create, get, list, reject };

export {
	ContinuityIdInput,
	CreateProposalInput,
	ProposalIdInput,
	orderProposals,
};
export type { ProposalItemView, ProposalView };
