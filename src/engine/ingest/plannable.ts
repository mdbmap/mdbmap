import type { Identity, Profile, Service } from "@/engine/identity.ts";
import { isTitleAdmitted } from "@/engine/identity.ts";

import { instalmentEnumerableServices } from "./enumerable-services.ts";

type TargetPlan =
	| { readonly kind: "atomic"; readonly service: Service }
	| { readonly kind: "enumerated"; readonly service: Service };

const targetPlansFor = (
	identity: Identity,
	profile: Profile,
): readonly TargetPlan[] => {
	if (identity.kind !== "title" || !isTitleAdmitted(profile, identity.title)) {
		return [];
	}
	if (profile === "anime") {
		return [...instalmentEnumerableServices]
			.filter((service) => service !== identity.title.service)
			.map((service) => ({
				kind: "enumerated" as const,
				service,
			}));
	}
	if (identity.title.service === "tmdb") {
		return [{ kind: "atomic", service: "imdb" }];
	}
	if (identity.title.service === "imdb") {
		return [{ kind: "atomic", service: "tmdb" }];
	}
	return [];
};

const isIngestPlannable = (identity: Identity, profile: Profile): boolean =>
	identity.kind === "title" && targetPlansFor(identity, profile).length > 0;

export { isIngestPlannable, targetPlansFor };
export type { TargetPlan };
