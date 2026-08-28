import { and, eq } from "drizzle-orm";

import type { Db } from "@/db";
import type { InstalmentLocatorKind } from "@/db/engine-schema";
import { serviceInstalments, serviceTitles } from "@/db/engine-schema";
import type { InstalmentLocator } from "@/db/schema";
import type {
	EnumeratedTitle,
	ServiceRef,
} from "@/engine/discovery/structural.ts";
import type { PublishedAlignment } from "@/engine/matcher";
import type { FreshPairing } from "@/engine/recompute/recompute.ts";

const locatorKindFor = (locator: InstalmentLocator): InstalmentLocatorKind =>
	/^s\d+e\d+/u.test(locator) ? "position" : "service-id";

const findTitleId = async (
	db: Db,
	ref: ServiceRef,
): Promise<number | undefined> => {
	const row = await db
		.select({ id: serviceTitles.id })
		.from(serviceTitles)
		.where(
			and(
				eq(serviceTitles.service, ref.service),
				eq(serviceTitles.serviceId, ref.serviceId),
			),
		)
		.get();
	return row?.id;
};

const ensureTitle = async (
	db: Db,
	groupId: number,
	ref: ServiceRef,
	ordinal: number,
): Promise<number> => {
	const existing = await findTitleId(db, ref);
	if (existing !== undefined) {
		return existing;
	}
	const rows = await db
		.insert(serviceTitles)
		.values({
			groupId,
			ordinal,
			service: ref.service,
			serviceId: ref.serviceId,
		})
		.onConflictDoNothing()
		.returning()
		.all();
	const [inserted] = rows;
	if (inserted !== undefined) {
		return inserted.id;
	}
	const raced = await findTitleId(db, ref);
	if (raced === undefined) {
		throw new Error(
			"publish: title claim raced without a winning service_title",
		);
	}
	return raced;
};

const spokeIdFor = async (
	db: Db,
	titleId: number,
	locator: InstalmentLocator,
): Promise<number | undefined> => {
	const row = await db
		.select({ id: serviceInstalments.id })
		.from(serviceInstalments)
		.where(
			and(
				eq(serviceInstalments.titleId, titleId),
				eq(serviceInstalments.locator, locator),
			),
		)
		.get();
	return row?.id;
};

const ensureSpokes = async (
	db: Db,
	titleId: number,
	enumeration: EnumeratedTitle,
): Promise<void> => {
	await Promise.all(
		enumeration.stream.instalments.map(async (instalment) => {
			await db
				.insert(serviceInstalments)
				.values({
					locator: instalment.locator,
					locatorKind: locatorKindFor(instalment.locator),
					titleId,
				})
				.onConflictDoUpdate({
					set: {
						locatorKind: locatorKindFor(instalment.locator),
					},
					target: [serviceInstalments.titleId, serviceInstalments.locator],
				})
				.run();
		}),
	);
};

const resolveSpokeIds = async (
	db: Db,
	titleId: number,
	locators: readonly InstalmentLocator[],
): Promise<number[]> => {
	const ids = await Promise.all(
		locators.map(async (entry) => spokeIdFor(db, titleId, entry)),
	);
	return ids.filter((id): id is number => id !== undefined);
};

const pairingsFromAlignment = async (
	db: Db,
	anchorTitleId: number,
	targetTitleId: number,
	alignment: PublishedAlignment,
	source: FreshPairing["source"],
): Promise<readonly FreshPairing[]> => {
	const nested = await Promise.all(
		alignment.pairs.map(async (pair) => {
			const [leftIds, rightIds] = await Promise.all([
				resolveSpokeIds(db, anchorTitleId, pair.left),
				resolveSpokeIds(db, targetTitleId, pair.right),
			]);
			const spokeIds = [...leftIds, ...rightIds];
			if (spokeIds.length < 2) {
				return [] as const;
			}
			return [{ confidence: pair.confidence, source, spokeIds }];
		}),
	);
	return nested.flat();
};

export { ensureSpokes, ensureTitle, pairingsFromAlignment };
