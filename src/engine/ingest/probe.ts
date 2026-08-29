import type { SimklClient } from "@/engine/discovery/simkl.ts";
import { isSimklService } from "@/engine/discovery/simkl.ts";
import type { CatalogueClient } from "@/engine/discovery/verify.ts";
import type { Service, TitleIdentity } from "@/engine/identity.ts";

type ProbeRefusalReason = "no-record" | "request-failed" | "unconfigured";

type ProbeResult =
	| { readonly kind: "confirmed" }
	| { readonly kind: "refused"; readonly reason: ProbeRefusalReason };

interface ProbeDeps {
	readonly catalogues?: Partial<Record<Service, CatalogueClient>>;
	readonly simkl?: SimklClient;
}

const simklTypeMatches = (
	title: TitleIdentity,
	entryType: "anime" | "movie" | "show",
): boolean => {
	if (title.service !== "tmdb") {
		return true;
	}
	if (title.namespace === "movie") {
		return entryType === "movie";
	}
	return entryType === "show" || entryType === "anime";
};

const probeCatalogue = async (input: {
	readonly deps: ProbeDeps;
	readonly fallbackReason: ProbeRefusalReason;
	readonly title: TitleIdentity;
}): Promise<ProbeResult> => {
	const client = input.deps.catalogues?.[input.title.service];
	if (client === undefined) {
		return { kind: "refused", reason: input.fallbackReason };
	}
	try {
		const record = await client.fetchTitle(input.title.id);
		return record === undefined
			? { kind: "refused", reason: "no-record" }
			: { kind: "confirmed" };
	} catch {
		return { kind: "refused", reason: "request-failed" };
	}
};

const probeUpstream = async (
	title: TitleIdentity,
	deps: ProbeDeps,
): Promise<ProbeResult> => {
	if (isSimklService(title.service)) {
		const { simkl } = deps;
		if (simkl !== undefined) {
			try {
				const entry = await simkl.findByExternalId(title.service, title.id);
				if (entry !== undefined && simklTypeMatches(title, entry.type)) {
					return { kind: "confirmed" };
				}
			} catch {
				return probeCatalogue({
					deps,
					fallbackReason: "request-failed",
					title,
				});
			}
			return probeCatalogue({ deps, fallbackReason: "no-record", title });
		}
	}
	return probeCatalogue({ deps, fallbackReason: "unconfigured", title });
};

export { probeUpstream };
export type { ProbeDeps, ProbeRefusalReason, ProbeResult };
