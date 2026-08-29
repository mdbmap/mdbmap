import { eq } from "drizzle-orm";

import { resolveDb } from "@/db";
import type { Db as GatewayDb } from "@/db";
import { serviceCoverages } from "@/db/engine-schema";
import type { CoverageState } from "@/db/engine-schema";

const RETRY_AFTER_SECONDS = 5;
const pendingRefPattern = /^pending:(?<encoded>[0-9a-z]+)$/u;

type IngestStatus =
	| { readonly retryAfterSeconds: number; readonly status: "running" }
	| { readonly status: "complete" }
	| { readonly status: "conflict" };

interface IngestStatusDeps {
	readonly db?: GatewayDb;
}

const coverageIdFrom = (ref: string): number | undefined => {
	const match = pendingRefPattern.exec(ref);
	const encoded = match?.groups?.["encoded"];
	if (encoded === undefined) {
		return undefined;
	}
	const id = Number.parseInt(encoded, 36);
	return Number.isSafeInteger(id) && id > 0 ? id : undefined;
};

const statusFrom = (state: CoverageState): IngestStatus => {
	switch (state) {
		case "pending": {
			return { retryAfterSeconds: RETRY_AFTER_SECONDS, status: "running" };
		}
		case "complete":
		case "open": {
			return { status: "complete" };
		}
		case "conflict": {
			return { status: "conflict" };
		}
	}
};

const readIngestStatus = async (
	db: GatewayDb,
	ref: string,
): Promise<IngestStatus | undefined> => {
	const id = coverageIdFrom(ref);
	if (id === undefined) {
		return undefined;
	}
	const row = await db
		.select({ state: serviceCoverages.state })
		.from(serviceCoverages)
		.where(eq(serviceCoverages.id, id))
		.get();
	return row === undefined ? undefined : statusFrom(row.state);
};

const runIngestStatus = async (
	ref: string,
	deps: IngestStatusDeps = {},
): Promise<Response> => {
	const status = await readIngestStatus(deps.db ?? (await resolveDb()), ref);
	if (status === undefined) {
		return Response.json({ error: "ingest status not found" }, { status: 404 });
	}
	return Response.json(status);
};

export { runIngestStatus };
