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

const uniqueSegmentIds = (ids: readonly number[]): boolean =>
	new Set(ids).size === ids.length;

const CreateProposalInput = z.object({
	continuityId: z.number().int().min(1),
	name: z.string().trim().min(1).max(120),
	rationale: z.string().trim().min(1).max(2000),
	segmentIds: z.array(z.number().int().min(1)).min(1).refine(uniqueSegmentIds, {
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
	const rows = await db
		.select({
			continuityId: continuitySegments.continuityId,
			id: continuitySegments.id,
		})
		.from(continuitySegments)
		.where(inArray(continuitySegments.id, [...segmentIds]))
		.all();
	const byId = new Map(rows.map((row) => [row.id, row.continuityId]));
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

const toView = async (
	db: Db,
	row: {
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
	},
): Promise<ProposalView> => {
	const view: ProposalView = {
		authorUserId: row.authorUserId,
		continuityId: row.continuityId,
		createdAt: row.createdAt,
		id: row.id,
		items: await itemsFor(db, row.id),
		name: row.name,
		rationale: row.rationale,
		status: row.status,
		updatedAt: row.updatedAt,
	};
	if (row.reviewedAt !== null) {
		return {
			...view,
			reviewedAt: row.reviewedAt,
			...(row.reviewedByUserId === null
				? {}
				: { reviewedByUserId: row.reviewedByUserId }),
		};
	}
	return view;
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
	return toView(db, row);
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
		const inserted = await context.db
			.insert(presentationOrderProposals)
			.values({
				authorUserId: context.user.id,
				continuityId: input.continuityId,
				name: input.name,
				rationale: input.rationale,
				status: "pending",
			})
			.returning()
			.get();
		if (inserted === undefined) {
			throw new ORPCError("INTERNAL_SERVER_ERROR", {
				message: "Failed to create proposal.",
			});
		}
		await context.db
			.insert(presentationOrderProposalItems)
			.values(
				input.segmentIds.map((segmentId, position) => ({
					position,
					proposalId: inserted.id,
					segmentId,
				})),
			)
			.run();
		return toView(context.db, inserted);
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
		return Promise.all(rows.map(async (row) => toView(context.db, row)));
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
	await db
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
		.run();
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
