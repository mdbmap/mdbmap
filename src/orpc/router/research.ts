import type { ResearchTiming } from "@/db/schema";
import { createDbTimingStore } from "@/engine/research";
import { admin } from "@/orpc/base";
import { SetResearchTimingInput } from "@/orpc/schema";

// Admin-backed research timing policy (ADR-0004 / issue #59).
const getTiming = admin.handler(
	async ({ context }): Promise<ResearchTiming> =>
		createDbTimingStore(context.db).read(),
);

const setTiming = admin
	.input(SetResearchTimingInput)
	.handler(async ({ context, input }): Promise<ResearchTiming> => {
		const store = createDbTimingStore(context.db);
		await store.write(input.timing);
		return store.read();
	});

const research = { getTiming, setTiming };

export { research };
