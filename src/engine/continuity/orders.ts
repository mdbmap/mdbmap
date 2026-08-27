import { and, asc, eq, inArray } from "drizzle-orm";

import type { Db } from "@/db";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import {
	continuitySegments,
	presentationOrderItems,
	presentationOrders,
} from "@/db/engine-schema";

interface WatchItemSnapshot {
	readonly position: number;
	readonly titleId: number;
}

interface SelectedPresentationOrder {
	readonly releaseSegmentIds: readonly number[];
	readonly segmentIds: readonly number[];
	readonly slug: PresentationOrderSlug;
}

interface PersistWatchOrderInput {
	readonly continuityId: number;
	readonly segmentIds: readonly number[];
}

const orderLabels = {
	release: "Release",
	watch: "Watch",
} as const;

const defaultPresentationSlug = (
	slugs: readonly PresentationOrderSlug[],
): PresentationOrderSlug => (slugs.includes("watch") ? "watch" : "release");

const resolvePresentationSlug = (
	slugs: readonly PresentationOrderSlug[],
	requested: PresentationOrderSlug | undefined,
): PresentationOrderSlug => {
	if (requested !== undefined && slugs.includes(requested)) {
		return requested;
	}
	return defaultPresentationSlug(slugs);
};

const reorderByIds = <Item>(
	items: readonly Item[],
	itemIds: readonly number[],
	orderIds: readonly number[],
): Item[] => {
	const byId = new Map<number, Item>();
	for (const [index, id] of itemIds.entries()) {
		const item = items[index];
		if (item !== undefined) {
			byId.set(id, item);
		}
	}
	return orderIds.flatMap((id) => {
		const item = byId.get(id);
		return item === undefined ? [] : [item];
	});
};

const releaseSegmentIds = async (
	db: Db,
	continuityId: number,
): Promise<number[]> => {
	const rows = await db
		.select({ id: continuitySegments.id })
		.from(continuitySegments)
		.where(eq(continuitySegments.continuityId, continuityId))
		.orderBy(asc(continuitySegments.releaseOrdinal))
		.all();
	return rows.map((row) => row.id);
};

const replaceItems = async (
	db: Db,
	orderId: number,
	segmentIds: readonly number[],
): Promise<void> => {
	await db
		.delete(presentationOrderItems)
		.where(eq(presentationOrderItems.orderId, orderId))
		.run();
	if (segmentIds.length === 0) {
		return;
	}
	await db
		.insert(presentationOrderItems)
		.values(
			segmentIds.map((segmentId, position) => ({
				orderId,
				position,
				segmentId,
			})),
		)
		.run();
};

const refreshDefault = async (db: Db, continuityId: number): Promise<void> => {
	const rows = await db
		.select({ slug: presentationOrders.slug })
		.from(presentationOrders)
		.where(eq(presentationOrders.continuityId, continuityId))
		.all();
	if (rows.length === 0) {
		return;
	}
	const slug = defaultPresentationSlug(rows.map((row) => row.slug));
	await db
		.update(presentationOrders)
		.set({ isDefault: false })
		.where(eq(presentationOrders.continuityId, continuityId))
		.run();
	await db
		.update(presentationOrders)
		.set({ isDefault: true })
		.where(
			and(
				eq(presentationOrders.continuityId, continuityId),
				eq(presentationOrders.slug, slug),
			),
		)
		.run();
};

const upsertOrder = async (
	db: Db,
	continuityId: number,
	slug: PresentationOrderSlug,
): Promise<number> => {
	await db
		.insert(presentationOrders)
		.values({
			continuityId,
			isDefault: false,
			label: orderLabels[slug],
			slug,
		})
		.onConflictDoUpdate({
			set: { label: orderLabels[slug] },
			target: [presentationOrders.continuityId, presentationOrders.slug],
		})
		.run();
	const row = await db
		.select({ id: presentationOrders.id })
		.from(presentationOrders)
		.where(
			and(
				eq(presentationOrders.continuityId, continuityId),
				eq(presentationOrders.slug, slug),
			),
		)
		.get();
	if (row === undefined) {
		throw new Error(`engine: missing presentation order ${slug}`);
	}
	return row.id;
};

const regenerateReleaseOrder = async (
	db: Db,
	continuityId: number,
): Promise<void> => {
	const orderId = await upsertOrder(db, continuityId, "release");
	await replaceItems(db, orderId, await releaseSegmentIds(db, continuityId));
	await refreshDefault(db, continuityId);
};

const persistWatchOrder = async (
	db: Db,
	input: PersistWatchOrderInput,
): Promise<void> => {
	if (input.segmentIds.length === 0) {
		throw new Error("engine: watch order needs at least one segment");
	}
	const rows = await db
		.select({
			continuityId: continuitySegments.continuityId,
			id: continuitySegments.id,
		})
		.from(continuitySegments)
		.where(inArray(continuitySegments.id, [...input.segmentIds]))
		.all();
	const byId = new Map(rows.map((row) => [row.id, row.continuityId]));
	if (
		input.segmentIds.some(
			(segmentId) => byId.get(segmentId) !== input.continuityId,
		)
	) {
		throw new Error(
			"engine: presentation order segment does not belong to continuity",
		);
	}
	const orderId = await upsertOrder(db, input.continuityId, "watch");
	await replaceItems(db, orderId, input.segmentIds);
	await refreshDefault(db, input.continuityId);
};

const snapshotWatchOrder = async (
	db: Db,
	continuityId: number,
): Promise<readonly WatchItemSnapshot[]> =>
	db
		.select({
			position: presentationOrderItems.position,
			titleId: continuitySegments.titleId,
		})
		.from(presentationOrderItems)
		.innerJoin(
			presentationOrders,
			eq(presentationOrderItems.orderId, presentationOrders.id),
		)
		.innerJoin(
			continuitySegments,
			eq(presentationOrderItems.segmentId, continuitySegments.id),
		)
		.where(
			and(
				eq(presentationOrders.continuityId, continuityId),
				eq(presentationOrders.slug, "watch"),
			),
		)
		.orderBy(asc(presentationOrderItems.position))
		.all();

const restoreWatchOrder = async (
	db: Db,
	continuityId: number,
	items: readonly WatchItemSnapshot[],
): Promise<void> => {
	if (items.length === 0) {
		return;
	}
	const segments = await db
		.select({
			id: continuitySegments.id,
			titleId: continuitySegments.titleId,
		})
		.from(continuitySegments)
		.where(eq(continuitySegments.continuityId, continuityId))
		.all();
	const idByTitle = new Map(
		segments.map((segment) => [segment.titleId, segment.id]),
	);
	const segmentIds = items.flatMap((item) => {
		const segmentId = idByTitle.get(item.titleId);
		return segmentId === undefined ? [] : [segmentId];
	});
	if (segmentIds.length === 0) {
		await db
			.delete(presentationOrders)
			.where(
				and(
					eq(presentationOrders.continuityId, continuityId),
					eq(presentationOrders.slug, "watch"),
				),
			)
			.run();
		await refreshDefault(db, continuityId);
		return;
	}
	await persistWatchOrder(db, { continuityId, segmentIds });
};

const afterSegmentRewrite = async (
	db: Db,
	continuityId: number,
	watch: readonly WatchItemSnapshot[],
): Promise<void> => {
	await regenerateReleaseOrder(db, continuityId);
	await restoreWatchOrder(db, continuityId, watch);
};

const selectPresentationOrder = async (
	db: Db,
	continuityId: number,
	requested?: PresentationOrderSlug,
): Promise<SelectedPresentationOrder> => {
	const existing = await db
		.select({ id: presentationOrders.id })
		.from(presentationOrders)
		.where(
			and(
				eq(presentationOrders.continuityId, continuityId),
				eq(presentationOrders.slug, "release"),
			),
		)
		.get();
	if (existing === undefined) {
		await regenerateReleaseOrder(db, continuityId);
	}
	const orders = await db
		.select({ slug: presentationOrders.slug })
		.from(presentationOrders)
		.where(eq(presentationOrders.continuityId, continuityId))
		.all();
	const slugs = orders.map((row) => row.slug);
	const slug = resolvePresentationSlug(slugs, requested);
	const releaseIds = await releaseSegmentIds(db, continuityId);
	const items = await db
		.select({ segmentId: presentationOrderItems.segmentId })
		.from(presentationOrderItems)
		.innerJoin(
			presentationOrders,
			eq(presentationOrderItems.orderId, presentationOrders.id),
		)
		.where(
			and(
				eq(presentationOrders.continuityId, continuityId),
				eq(presentationOrders.slug, slug),
			),
		)
		.orderBy(asc(presentationOrderItems.position))
		.all();
	const segmentIds = items.map((item) => item.segmentId);
	return {
		releaseSegmentIds: releaseIds,
		segmentIds: segmentIds.length === 0 ? releaseIds : segmentIds,
		slug,
	};
};

export {
	afterSegmentRewrite,
	defaultPresentationSlug,
	persistWatchOrder,
	regenerateReleaseOrder,
	reorderByIds,
	resolvePresentationSlug,
	selectPresentationOrder,
	snapshotWatchOrder,
};
export type {
	PersistWatchOrderInput,
	SelectedPresentationOrder,
	WatchItemSnapshot,
};
