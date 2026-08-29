import { asc, eq } from "drizzle-orm";

import type { Db } from "@/db";
import { serviceTitles } from "@/db/engine-schema";
import { runFuzzyDiscovery } from "@/engine/discovery";
import type {
	FuzzyQuery,
	FuzzySearchClients,
	VerificationClients,
} from "@/engine/discovery";

type AfterPublishScheduler = (task: Promise<void>) => void;

interface AfterPublishFuzzyConfig {
	readonly clients: FuzzySearchClients;
	readonly scheduler: AfterPublishScheduler;
	readonly catalogues: VerificationClients;
}

interface AfterPublishFuzzyInput extends AfterPublishFuzzyConfig {
	readonly db: Db;
	readonly groupId: number;
}

const yearOf = (releaseDate: string | undefined): number | undefined => {
	if (releaseDate === undefined) {
		return undefined;
	}
	const year = Number(releaseDate.slice(0, 4));
	return Number.isInteger(year) ? year : undefined;
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
			const metadata = await client.fetchTitle(title.serviceId);
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
	input.scheduler(
		(async () => {
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
		})(),
	);
};

export { scheduleAfterPublishFuzzy };
export type {
	AfterPublishFuzzyConfig,
	AfterPublishFuzzyInput,
	AfterPublishScheduler,
};
