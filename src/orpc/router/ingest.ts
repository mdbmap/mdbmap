import { admin } from "@/orpc/base";
import type { AdminIngestStartResult } from "@/orpc/schema";
import { IngestStartInput } from "@/orpc/schema";

import { runColdStart } from "./cold-start";

const start = admin
	.input(IngestStartInput)
	.handler(async ({ context, input }): Promise<AdminIngestStartResult> => {
		const { outcome } = await runColdStart(
			input.identity,
			input.profile,
			context.resolveIngest,
		);
		return outcome;
	});

const ingest = { start };

export { ingest };
