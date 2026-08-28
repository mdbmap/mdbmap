import { and, eq } from "drizzle-orm";

import type { Db } from "@/db";
import {
	contentUnits,
	instalmentAssertions,
	serviceInstalments,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import { one } from "@/db/one";
import { ensureGroupContinuity } from "@/engine/continuity/persist.ts";
import { toGraphMember } from "@/engine/gateway/keys.ts";
import { survivorGroupId } from "@/engine/gateway/read.ts";
import type { Identity, TitleIdentity } from "@/engine/identity.ts";

interface BootstrappedGroup {
	readonly baselineContinuity: `group:${number}`;
	readonly continuityId: number;
	readonly groupId: number;
	readonly requestedTitleId: number;
}

type BootstrapRefusalReason = "unsupported-identity";

type BootstrapResult =
	| { readonly kind: "bootstrapped"; readonly group: BootstrappedGroup }
	| { readonly kind: "refused"; readonly reason: BootstrapRefusalReason };

const findExistingTitle = async (db: Db, service: string, serviceId: string) =>
	db
		.select()
		.from(serviceTitles)
		.where(
			and(
				eq(serviceTitles.service, service),
				eq(serviceTitles.serviceId, serviceId),
			),
		)
		.get();

const bootstrapped = async (
	db: Db,
	groupId: number,
	titleId: number,
): Promise<BootstrapResult> => {
	const resolvedGroupId = await survivorGroupId(db, groupId);
	const continuityId = await ensureGroupContinuity(db, resolvedGroupId);
	return {
		group: {
			baselineContinuity: `group:${resolvedGroupId}`,
			continuityId,
			groupId: resolvedGroupId,
			requestedTitleId: titleId,
		},
		kind: "bootstrapped",
	};
};

const insertHubSpokes = async (
	db: Db,
	groupId: number,
	title: TitleIdentity,
): Promise<number> => {
	const member = toGraphMember(title);
	const unitRows = await db.insert(contentUnits).values({}).returning().all();
	const unitId = one(unitRows).id;
	const titleRows = await db
		.insert(serviceTitles)
		.values({
			groupId,
			ordinal: 0,
			service: member.service,
			serviceId: member.serviceId,
		})
		.returning()
		.all();
	const titleId = one(titleRows).id;
	const spokeRows = await db
		.insert(serviceInstalments)
		.values({ locator: "s1e1", locatorKind: "position", titleId })
		.returning()
		.all();
	const spokeId = one(spokeRows).id;
	await db
		.insert(instalmentAssertions)
		.values({
			confidence: "high",
			instalmentId: spokeId,
			source: "t3-episode",
			unitId,
		})
		.run();
	return titleId;
};

const claimGroup = async (
	db: Db,
	title: TitleIdentity,
): Promise<BootstrapResult> => {
	const member = toGraphMember(title);
	const existing = await findExistingTitle(
		db,
		member.service,
		member.serviceId,
	);
	if (existing !== undefined) {
		return bootstrapped(db, existing.groupId, existing.id);
	}

	const groupRows = await db
		.insert(titleGroups)
		.values({ source: "release" })
		.returning()
		.all();
	const groupId = one(groupRows).id;

	try {
		const titleId = await insertHubSpokes(db, groupId, title);
		return await bootstrapped(db, groupId, titleId);
	} catch {
		await db.delete(titleGroups).where(eq(titleGroups.id, groupId)).run();
		const raced = await findExistingTitle(db, member.service, member.serviceId);
		if (raced === undefined) {
			throw new Error("bootstrap: claim raced without a winning service_title");
		}
		return bootstrapped(db, raced.groupId, raced.id);
	}
};

const bootstrapFromIdentity = async (
	db: Db,
	identity: Identity,
): Promise<BootstrapResult> => {
	if (identity.kind !== "title") {
		return { kind: "refused", reason: "unsupported-identity" };
	}
	return claimGroup(db, identity.title);
};

export { bootstrapFromIdentity };
export type { BootstrappedGroup, BootstrapRefusalReason, BootstrapResult };
