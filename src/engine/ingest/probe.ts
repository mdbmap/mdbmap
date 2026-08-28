import type { SimklClient, SimklService } from "@/engine/discovery/simkl.ts";
import { simklServices } from "@/engine/discovery/simkl.ts";
import type { CatalogueClient } from "@/engine/discovery/verify.ts";
import { toGraphMember } from "@/engine/gateway/keys.ts";
import type { Service, TitleIdentity } from "@/engine/identity.ts";

type ProbeRefusalReason = "no-record" | "request-failed" | "unconfigured";

type ProbeResult =
	| { readonly kind: "confirmed" }
	| { readonly kind: "refused"; readonly reason: ProbeRefusalReason };

interface ProbeDeps {
	readonly catalogues?: Partial<Record<Service, CatalogueClient>>;
	readonly simkl?: SimklClient;
}

const isSimklService = (value: string): value is SimklService =>
	(simklServices as readonly string[]).includes(value);

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

const probeUpstream = async (
	title: TitleIdentity,
	deps: ProbeDeps,
): Promise<ProbeResult> => {
	const member = toGraphMember(title);
	if (isSimklService(member.service)) {
		const { simkl } = deps;
		if (simkl === undefined) {
			return { kind: "refused", reason: "unconfigured" };
		}
		try {
			const entry = await simkl.findByExternalId(member.service, title.id);
			if (entry === undefined || !simklTypeMatches(title, entry.type)) {
				return { kind: "refused", reason: "no-record" };
			}
			return { kind: "confirmed" };
		} catch {
			return { kind: "refused", reason: "request-failed" };
		}
	}

	const client = deps.catalogues?.[member.service];
	if (client === undefined) {
		return { kind: "refused", reason: "unconfigured" };
	}
	try {
		const record = await client.fetchTitle(member.serviceId);
		return record === undefined
			? { kind: "refused", reason: "no-record" }
			: { kind: "confirmed" };
	} catch {
		return { kind: "refused", reason: "request-failed" };
	}
};

export { probeUpstream };
export type { ProbeDeps, ProbeRefusalReason, ProbeResult };
