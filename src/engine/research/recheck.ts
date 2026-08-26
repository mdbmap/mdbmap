import { eq, inArray } from "drizzle-orm";

import type { Db } from "@/db";
import {
	instalmentAssertions,
	relationAssertions,
	serviceTitles,
	titleAssertions,
} from "@/db/engine-schema";
import { titleSimilarity } from "@/engine/matcher";
import type { BudgetLedger } from "@/engine/matcher";

import type { ResearchAssertion } from "./assertions.ts";
import { listResearchAssertions } from "./assertions.ts";
import { toCatalogueTitle } from "./catalogue.ts";
import type { ResearchCatalogueRecord } from "./catalogue.ts";
import { fetchCatalogueRecord } from "./fetch-catalogue-record.ts";
import {
	queueInstalmentFlag,
	queueRelationFlag,
	queueTitlePairFlag,
} from "./low-confidence-flag.ts";
import type { ResearchCatalogueClients } from "./tools.ts";

const FETCH_COST = 1;
const TITLE_AGREEMENT = 0.5;

type RecheckVerdict = "agrees" | "disagrees" | "unavailable";

interface ResearchRecheckOutcome {
	readonly checked: number;
	readonly flagged: number;
	readonly remainingBudget: number;
}

const fetchPair = async (
	clients: ResearchCatalogueClients,
	left: { readonly service: string; readonly serviceId: string },
	right: { readonly service: string; readonly serviceId: string },
	budget: BudgetLedger,
): Promise<
	| { readonly kind: "pair"; readonly left: ResearchCatalogueRecord; readonly right: ResearchCatalogueRecord }
	| { readonly kind: "unavailable" }
> => {
	if (!budget.spend(FETCH_COST)) {
		return { kind: "unavailable" };
	}
	const leftRecord = await fetchCatalogueRecord(
		clients[left.service],
		left.serviceId,
	);
	if (leftRecord === undefined) {
		return { kind: "unavailable" };
	}
	if (!budget.spend(FETCH_COST)) {
		return { kind: "unavailable" };
	}
	const rightRecord = await fetchCatalogueRecord(
		clients[right.service],
		right.serviceId,
	);
	if (rightRecord === undefined) {
		return { kind: "unavailable" };
	}
	return { kind: "pair", left: leftRecord, right: rightRecord };
};

const recheckTitle = async (
	assertion: Extract<ResearchAssertion, { kind: "title" }>,
	clients: ResearchCatalogueClients,
	budget: BudgetLedger,
): Promise<RecheckVerdict> => {
	const fetched = await fetchPair(clients, assertion.left, assertion.right, budget);
	if (fetched.kind === "unavailable") {
		return "unavailable";
	}
	const leftTitle = toCatalogueTitle(fetched.left).title;
	const rightTitle = toCatalogueTitle(fetched.right).title;
	return titleSimilarity(leftTitle, rightTitle) >= TITLE_AGREEMENT
		? "agrees"
		: "disagrees";
};

const titleRowMatches = (
	row: { readonly service: string; readonly serviceId: string },
	ref: { readonly service: string; readonly serviceId: string },
): boolean => row.service === ref.service && row.serviceId === ref.serviceId;

const recheckRelation = async (
	db: Db,
	assertion: Extract<ResearchAssertion, { kind: "relation" }>,
	clients: ResearchCatalogueClients,
	budget: BudgetLedger,
): Promise<RecheckVerdict> => {
	const rows = await db
		.select({
			id: serviceTitles.id,
			service: serviceTitles.service,
			serviceId: serviceTitles.serviceId,
		})
		.from(serviceTitles)
		.where(
			inArray(serviceTitles.id, [
				assertion.fromTitleId,
				assertion.toTitleId,
			]),
		)
		.all();
	if (rows.length !== 2) {
		return "disagrees";
	}
	const fromRow = rows.find((row) => row.id === assertion.fromTitleId);
	const toRow = rows.find((row) => row.id === assertion.toTitleId);
	if (
		fromRow === undefined ||
		toRow === undefined ||
		!titleRowMatches(fromRow, assertion.from) ||
		!titleRowMatches(toRow, assertion.to)
	) {
		return "disagrees";
	}

	const fetched = await fetchPair(clients, assertion.from, assertion.to, budget);
	if (fetched.kind === "unavailable") {
		return "unavailable";
	}

	const fromTitle = toCatalogueTitle(fetched.left).title.trim();
	const toTitle = toCatalogueTitle(fetched.right).title.trim();
	if (fromTitle.length === 0 || toTitle.length === 0) {
		return "disagrees";
	}

	return "agrees";
};

const recheckInstalment = async (
	assertion: Extract<ResearchAssertion, { kind: "instalment" }>,
	clients: ResearchCatalogueClients,
	budget: BudgetLedger,
): Promise<RecheckVerdict> => {
	if (!budget.spend(FETCH_COST)) {
		return "unavailable";
	}
	const record = await fetchCatalogueRecord(
		clients[assertion.ref.service],
		assertion.ref.serviceId,
	);
	if (record === undefined) {
		return "unavailable";
	}
	const present = record.instalments.some(
		(instalment) => instalment.locator === assertion.locator,
	);
	return present ? "agrees" : "disagrees";
};

const fetchCostFor = (assertion: ResearchAssertion): number =>
	assertion.kind === "instalment" ? FETCH_COST : FETCH_COST * 2;

const recheckAssertion = async (
	db: Db,
	assertion: ResearchAssertion,
	clients: ResearchCatalogueClients,
	budget: BudgetLedger,
): Promise<RecheckVerdict> => {
	switch (assertion.kind) {
		case "title": {
			return recheckTitle(assertion, clients, budget);
		}
		case "relation": {
			return recheckRelation(db, assertion, clients, budget);
		}
		case "instalment": {
			return recheckInstalment(assertion, clients, budget);
		}
		default: {
			throw new Error("recheck: unexpected assertion kind");
		}
	}
};

const demoteAndFlag = async (
	db: Db,
	assertion: ResearchAssertion,
): Promise<void> => {
	switch (assertion.kind) {
		case "title": {
			await db
				.update(titleAssertions)
				.set({ confidence: "low" })
				.where(eq(titleAssertions.id, assertion.id))
				.run();
			await queueTitlePairFlag(db, {
				assertionConfidence: assertion.confidence,
				titleAId: assertion.titleAId,
				titleBId: assertion.titleBId,
			});
			return;
		}
		case "relation": {
			await db
				.update(relationAssertions)
				.set({ confidence: "low" })
				.where(eq(relationAssertions.id, assertion.id))
				.run();
			await queueRelationFlag(db, {
				assertionConfidence: assertion.confidence,
				fromTitleId: assertion.fromTitleId,
				toTitleId: assertion.toTitleId,
			});
			return;
		}
		case "instalment": {
			await db
				.update(instalmentAssertions)
				.set({ confidence: "low" })
				.where(eq(instalmentAssertions.id, assertion.id))
				.run();
			await queueInstalmentFlag(db, {
				assertionConfidence: assertion.confidence,
				instalmentId: assertion.instalmentId,
				titleId: assertion.titleId,
				unitId: assertion.unitId,
			});
			return;
		}
		default: {
			throw new Error("recheck: unexpected assertion kind");
		}
	}
};

const sampleResearchRecheck = async (
	db: Db,
	input: {
		readonly budget: BudgetLedger;
		readonly clients: ResearchCatalogueClients;
		readonly groupId: number;
	},
): Promise<ResearchRecheckOutcome> => {
	const candidates = await listResearchAssertions(db, input.groupId);
	let checked = 0;
	let flagged = 0;

	const processFrom = async (index: number): Promise<void> => {
		const assertion = candidates[index];
		if (assertion === undefined) {
			return;
		}
		if (input.budget.snapshot().remaining < fetchCostFor(assertion)) {
			await processFrom(index + 1);
			return;
		}
		const verdict = await recheckAssertion(
			db,
			assertion,
			input.clients,
			input.budget,
		);
		checked += 1;
		if (verdict === "disagrees") {
			await demoteAndFlag(db, assertion);
			flagged += 1;
		}
		await processFrom(index + 1);
	};

	await processFrom(0);

	return {
		checked,
		flagged,
		remainingBudget: input.budget.snapshot().remaining,
	};
};

export {
	fetchCostFor,
	FETCH_COST,
	recheckAssertion,
	sampleResearchRecheck,
	TITLE_AGREEMENT,
};
export type { RecheckVerdict, ResearchRecheckOutcome };
