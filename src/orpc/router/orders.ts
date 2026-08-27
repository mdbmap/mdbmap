import { ORPCError } from "@orpc/server";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import type { ContinuitySegmentKind } from "@/db/engine-schema";
import {
	continuities,
	continuitySegments,
	presentationOrderItems,
	presentationOrders,
	serviceTitles,
} from "@/db/engine-schema";
import {
	persistWatchOrder,
	selectPresentationOrder,
} from "@/engine/continuity/orders";
import { admin } from "@/orpc/base";
import type { Db } from "@/orpc/context";

interface AdminSegment {
	readonly id: number;
	readonly kind: ContinuitySegmentKind;
	readonly releaseOrdinal: number;
	readonly service: string;
	readonly serviceId: string;
	readonly titleId: number;
}

interface ContinuityOrdersView {
	readonly continuityId: number;
	readonly releaseSegmentIds: readonly number[];
	readonly segments: readonly AdminSegment[];
	readonly watchSegmentIds?: readonly number[];
}

const ContinuityIdInput = z.object({
	continuityId: z.number().int().min(1),
});

const uniqueSegmentIds = (ids: readonly number[]): boolean =>
	new Set(ids).size === ids.length;

const SaveWatchOrderInput = ContinuityIdInput.extend({
	segmentIds: z.array(z.number().int().min(1)).min(1).refine(uniqueSegmentIds, {
		message: "Watch order segment ids must be unique",
	}),
});

const ENGINE_PREFIX = "engine:";

const mapOrderError = (error: unknown): never => {
	if (error instanceof Error && error.message.startsWith(ENGINE_PREFIX)) {
		throw new ORPCError("BAD_REQUEST", { message: error.message });
	}
	throw error;
};

const watchItemsFor = async (
	db: Db,
	continuityId: number,
): Promise<readonly number[]> => {
	const rows = await db
		.select({ segmentId: presentationOrderItems.segmentId })
		.from(presentationOrderItems)
		.innerJoin(
			presentationOrders,
			eq(presentationOrderItems.orderId, presentationOrders.id),
		)
		.where(
			and(
				eq(presentationOrders.continuityId, continuityId),
				eq(presentationOrders.slug, "watch"),
			),
		)
		.orderBy(asc(presentationOrderItems.position))
		.all();
	return rows.map((row) => row.segmentId);
};

const segmentsFor = async (
	db: Db,
	continuityId: number,
): Promise<readonly AdminSegment[]> =>
	db
		.select({
			id: continuitySegments.id,
			kind: continuitySegments.kind,
			releaseOrdinal: continuitySegments.releaseOrdinal,
			service: serviceTitles.service,
			serviceId: serviceTitles.serviceId,
			titleId: continuitySegments.titleId,
		})
		.from(continuitySegments)
		.innerJoin(serviceTitles, eq(serviceTitles.id, continuitySegments.titleId))
		.where(eq(continuitySegments.continuityId, continuityId))
		.orderBy(asc(continuitySegments.releaseOrdinal))
		.all();

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

const loadOrders = async (
	db: Db,
	continuityId: number,
): Promise<ContinuityOrdersView> => {
	await requireContinuity(db, continuityId);
	const selected = await selectPresentationOrder(db, continuityId);
	const watchSegmentIds = await watchItemsFor(db, continuityId);
	const view = {
		continuityId,
		releaseSegmentIds: selected.releaseSegmentIds,
		segments: await segmentsFor(db, continuityId),
	};
	if (watchSegmentIds.length === 0) {
		return view;
	}
	return { ...view, watchSegmentIds };
};

const get = admin
	.input(ContinuityIdInput)
	.handler(async ({ context, input }): Promise<ContinuityOrdersView> =>
		loadOrders(context.db, input.continuityId),
	);

const saveWatch = admin
	.input(SaveWatchOrderInput)
	.handler(async ({ context, input }): Promise<ContinuityOrdersView> => {
		try {
			await persistWatchOrder(context.db, {
				continuityId: input.continuityId,
				segmentIds: input.segmentIds,
			});
		} catch (error) {
			return mapOrderError(error);
		}
		return loadOrders(context.db, input.continuityId);
	});

const orders = { get, saveWatch };

export { ContinuityIdInput, SaveWatchOrderInput, orders };
export type { AdminSegment, ContinuityOrdersView };
