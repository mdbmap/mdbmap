import type { Db } from "@/db";
import { createDbTimingStore } from "@/engine/research";
import { researchAgent } from "@/engine/research/agent.ts";
import type { ReviewProposal } from "@/engine/reviewer";

import type {
	AfterPublishConfig,
	AfterPublishResearchConfig,
	AfterPublishScheduler,
} from "./after-publish.ts";
import type { CatalogueClients } from "./clients.ts";

const noopEnqueueReview = async (_proposal: ReviewProposal): Promise<void> => {
	await Promise.resolve();
};

const providerMasterKeyOf = (bindings: {
	readonly PROVIDER_CONFIG_MASTER_KEY?: string;
}): string | undefined => {
	const key = bindings.PROVIDER_CONFIG_MASTER_KEY;
	if (key === undefined || key.trim() === "") {
		return undefined;
	}
	return key;
};

const buildAfterPublishResearch = (
	db: Db,
	masterKey: string | undefined,
	catalogue: CatalogueClients,
): AfterPublishResearchConfig | undefined => {
	if (masterKey === undefined) {
		return undefined;
	}
	return {
		deps: {
			agent: researchAgent,
			clients: catalogue.verification,
			enqueueReview: noopEnqueueReview,
			masterKey,
			providerId: "",
			timing: createDbTimingStore(db),
			...(catalogue.simkl === undefined ? {} : { simkl: catalogue.simkl }),
		},
	};
};

const resolveAfterPublish = (input: {
	readonly catalogue: CatalogueClients;
	readonly defaultResearch: AfterPublishResearchConfig | undefined;
	readonly override?: AfterPublishConfig | undefined;
	readonly scheduler: AfterPublishScheduler;
}): AfterPublishConfig | undefined => {
	const overrideAfterPublish = input.override;
	const hasFuzzy =
		overrideAfterPublish !== undefined &&
		Object.keys(overrideAfterPublish.clients).length > 0;
	const research = overrideAfterPublish?.research ?? input.defaultResearch;
	const hasResearch = research !== undefined;
	if (!hasFuzzy && !hasResearch) {
		return undefined;
	}
	return {
		catalogues:
			overrideAfterPublish?.catalogues ?? input.catalogue.verification,
		clients: overrideAfterPublish?.clients ?? {},
		scheduler: overrideAfterPublish?.scheduler ?? input.scheduler,
		...(hasResearch ? { research } : {}),
	};
};

export { buildAfterPublishResearch, providerMasterKeyOf, resolveAfterPublish };
