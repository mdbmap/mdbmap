import { and, eq, inArray } from "drizzle-orm";

import type { Db } from "@/db";
import { ascendingPair } from "@/db";
import type { AssertionConfidence } from "@/db/columns.ts";
import {
	instalmentAssertions,
	relationAssertions,
	serviceInstalments,
	serviceTitles,
	titleAssertions,
} from "@/db/engine-schema";

import type { ServiceRef } from "./persist.ts";

const RESEARCH = "llm-research" as const;

interface ResearchAssertionBase {
	readonly confidence: AssertionConfidence;
	readonly id: number;
}

interface TitleResearchAssertion extends ResearchAssertionBase {
	readonly kind: "title";
	readonly left: ServiceRef;
	readonly right: ServiceRef;
	readonly titleAId: number;
	readonly titleBId: number;
}

interface RelationResearchAssertion extends ResearchAssertionBase {
	readonly from: ServiceRef;
	readonly fromTitleId: number;
	readonly kind: "relation";
	readonly to: ServiceRef;
	readonly toTitleId: number;
}

interface InstalmentResearchAssertion extends ResearchAssertionBase {
	readonly instalmentId: number;
	readonly kind: "instalment";
	readonly locator: string;
	readonly ref: ServiceRef;
	readonly titleId: number;
	readonly unitId: string;
}

type ResearchAssertion =
	| InstalmentResearchAssertion
	| RelationResearchAssertion
	| TitleResearchAssertion;

const titleRef = (row: {
	readonly service: string;
	readonly serviceId: string;
}): ServiceRef => ({
	service: row.service,
	serviceId: row.serviceId,
});

const listResearchAssertions = async (
	db: Db,
	groupId: number,
): Promise<readonly ResearchAssertion[]> => {
	const titlesInGroup = await db
		.select({
			id: serviceTitles.id,
			service: serviceTitles.service,
			serviceId: serviceTitles.serviceId,
		})
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, groupId))
		.all();
	const titleById = new Map(titlesInGroup.map((row) => [row.id, row]));

	const titleIds = titlesInGroup.map((row) => row.id);
	if (titleIds.length === 0) {
		return [];
	}

	const titleAssertionRows = await db
		.select({
			confidence: titleAssertions.confidence,
			id: titleAssertions.id,
			titleAId: titleAssertions.titleAId,
			titleBId: titleAssertions.titleBId,
		})
		.from(titleAssertions)
		.where(
			and(
				eq(titleAssertions.source, RESEARCH),
				inArray(titleAssertions.titleAId, titleIds),
				inArray(titleAssertions.titleBId, titleIds),
			),
		)
		.all();

	const titleResearch = titleAssertionRows.flatMap((row) => {
		const [titleAId, titleBId] = ascendingPair(row.titleAId, row.titleBId);
		const left = titleById.get(titleAId);
		const right = titleById.get(titleBId);
		if (left === undefined || right === undefined) {
			return [];
		}
		return [
			{
				confidence: row.confidence,
				id: row.id,
				kind: "title" as const,
				left: titleRef(left),
				right: titleRef(right),
				titleAId,
				titleBId,
			},
		];
	});

	const relationRows = await db
		.select({
			confidence: relationAssertions.confidence,
			fromTitleId: relationAssertions.fromTitleId,
			id: relationAssertions.id,
			toTitleId: relationAssertions.toTitleId,
		})
		.from(relationAssertions)
		.where(
			and(
				eq(relationAssertions.source, RESEARCH),
				inArray(relationAssertions.fromTitleId, titleIds),
				inArray(relationAssertions.toTitleId, titleIds),
			),
		)
		.all();

	const relationResearch = relationRows.flatMap((row) => {
		const from = titleById.get(row.fromTitleId);
		const to = titleById.get(row.toTitleId);
		if (from === undefined || to === undefined) {
			return [];
		}
		return [
			{
				confidence: row.confidence,
				from: titleRef(from),
				fromTitleId: row.fromTitleId,
				id: row.id,
				kind: "relation" as const,
				to: titleRef(to),
				toTitleId: row.toTitleId,
			},
		];
	});

	const instalmentRows = await db
		.select({
			confidence: instalmentAssertions.confidence,
			id: instalmentAssertions.id,
			instalmentId: instalmentAssertions.instalmentId,
			locator: serviceInstalments.locator,
			service: serviceTitles.service,
			serviceId: serviceTitles.serviceId,
			titleId: serviceInstalments.titleId,
			unitId: instalmentAssertions.unitId,
		})
		.from(instalmentAssertions)
		.innerJoin(
			serviceInstalments,
			eq(instalmentAssertions.instalmentId, serviceInstalments.id),
		)
		.innerJoin(serviceTitles, eq(serviceInstalments.titleId, serviceTitles.id))
		.where(
			and(
				eq(instalmentAssertions.source, RESEARCH),
				eq(serviceTitles.groupId, groupId),
			),
		)
		.all();

	const instalmentResearch = instalmentRows.map(
		(row): InstalmentResearchAssertion => ({
			confidence: row.confidence,
			id: row.id,
			instalmentId: row.instalmentId,
			kind: "instalment",
			locator: row.locator,
			ref: { service: row.service, serviceId: row.serviceId },
			titleId: row.titleId,
			unitId: row.unitId,
		}),
	);

	return [
		...titleResearch,
		...relationResearch,
		...instalmentResearch,
	].toSorted((left, right) => left.id - right.id);
};

export { listResearchAssertions, RESEARCH };
export type {
	InstalmentResearchAssertion,
	RelationResearchAssertion,
	ResearchAssertion,
	TitleResearchAssertion,
};
