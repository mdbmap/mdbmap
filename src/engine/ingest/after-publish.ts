import { asc, eq } from "drizzle-orm";

import type { Db } from "@/db";
import { serviceTitles } from "@/db/engine-schema";
import { runFuzzyDiscovery } from "@/engine/discovery";
import type {
	FuzzyQuery,
	FuzzySearchClients,
	VerificationClients,
} from "@/engine/discovery";
import type { GroupCoverageKey } from "@/engine/overflow/coverage.ts";
import { runResearchPass } from "@/engine/research";
import type { ResearchPassDeps } from "@/engine/research";
import { listProviders } from "@/lib/provider-config";

type AfterPublishScheduler = (task: Promise<void>) => void;

interface AfterPublishFuzzyConfig {
	readonly clients: FuzzySearchClients;
	readonly catalogues: VerificationClients;
	readonly scheduler?: AfterPublishScheduler;
}

interface AfterPublishFuzzyInput extends AfterPublishFuzzyConfig {
	readonly db: Db;
	readonly groupId: number;
}

interface AfterPublishResearchConfig {
	readonly deps: Omit<ResearchPassDeps, "db">;
}

interface AfterPublishResearchInput extends AfterPublishResearchConfig {
	readonly continuity: GroupCoverageKey;
	readonly db: Db;
	readonly groupId: number;
	readonly residue: readonly string[];
	readonly scheduler: AfterPublishScheduler;
}

type AfterPublishConfig = AfterPublishFuzzyConfig & {
	readonly research?: AfterPublishResearchConfig;
};

const YEAR_LENGTH = 4;

const yearOf = (releaseDate: string | undefined): number | undefined => {
	if (releaseDate === undefined) {
		return undefined;
	}
	const head = releaseDate.slice(0, YEAR_LENGTH);
	if (head.length < YEAR_LENGTH) {
		return undefined;
	}
	const year = Number(head);
	return Number.isNaN(year) ? undefined : year;
};

const queriesFor = async (
	db: Db,
	groupId: number,
	catalogues: VerificationClients,
): Promise<readonly FuzzyQuery[]> => {
	const titles = await db
		.select({
			service: serviceTitles.service,
			serviceId: serviceTitles.serviceId,
		})
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, groupId))
		.all();
	const queries = await Promise.all(
		titles.map(async (title) => {
			const client = Object.entries(catalogues).find(
				([service]) => service === title.service,
			)?.[1];
			if (client === undefined) {
				return;
			}
			let metadata;
			try {
				metadata = await client.fetchTitle(title.serviceId);
			} catch {
				return;
			}
			return metadata === undefined
				? undefined
				: {
						service: title.service,
						title: metadata.title,
						year: yearOf(metadata.releaseDate),
					};
		}),
	);
	return queries.filter((query): query is FuzzyQuery => query !== undefined);
};

const dbSubject = async (
	db: Db,
	groupId: number,
): Promise<number | undefined> => {
	const row = await db
		.select({ id: serviceTitles.id })
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, groupId))
		.orderBy(asc(serviceTitles.id))
		.limit(1)
		.get();
	return row?.id;
};

const scheduleAfterPublishFuzzy = (input: AfterPublishFuzzyInput): void => {
	const schedule = input.scheduler;
	if (schedule === undefined) {
		return;
	}
	schedule(
		(async () => {
			try {
				const subject = await dbSubject(input.db, input.groupId);
				if (subject === undefined) {
					return;
				}
				const queries = await queriesFor(
					input.db,
					input.groupId,
					input.catalogues,
				);
				if (queries.length === 0) {
					return;
				}
				await runFuzzyDiscovery(
					input.db,
					{ clients: input.clients },
					{ queries, subjectTitleId: subject },
				);
			} catch {
				return;
			}
		})(),
	);
};

const scheduleAfterPublishResearch = (
	input: AfterPublishResearchInput,
): void => {
	if (input.residue.length === 0) {
		return;
	}
	input.scheduler(
		(async () => {
			try {
				const providers = await listProviders(input.db, input.deps.masterKey);
				const providerId =
					input.deps.providerId.length > 0
						? input.deps.providerId
						: providers[0]?.id;
				if (providerId === undefined) {
					return;
				}
				await runResearchPass(
					{
						groupId: input.groupId,
						id: input.continuity,
						targetServices: input.residue,
					},
					"after-residue",
					{ ...input.deps, db: input.db, providerId },
				);
			} catch {
				return;
			}
		})(),
	);
};

export { scheduleAfterPublishFuzzy, scheduleAfterPublishResearch };
export type {
	AfterPublishConfig,
	AfterPublishFuzzyConfig,
	AfterPublishFuzzyInput,
	AfterPublishResearchConfig,
	AfterPublishResearchInput,
	AfterPublishScheduler,
};
