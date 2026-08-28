import { eq } from "drizzle-orm";

import type { Db } from "@/db";
import { serviceInstalments } from "@/db/engine-schema";
import type { InstalmentLocator } from "@/db/schema";
import { discoverStructuralGroup } from "@/engine/discovery/structural.ts";
import type {
	DiscoveryClients,
	DiscoveryOutcome,
	EnumeratedTitle,
	MemberMapping,
	ServiceRef,
} from "@/engine/discovery/structural.ts";
import { toGraphMember } from "@/engine/gateway/keys.ts";
import type { Service, TitleIdentity } from "@/engine/identity.ts";
import { createBudget, createTier3, runLadder } from "@/engine/matcher";
import type {
	AlignmentOutcome,
	FactsByLocator,
	InstalmentFacts,
	InstalmentStream,
	LadderResult,
	Tier,
	TierId,
} from "@/engine/matcher";

interface DiscoverInput {
	readonly anchor: TitleIdentity;
	readonly budget: number;
	readonly clients: DiscoveryClients;
}

interface DiscoveredGroup {
	readonly anchorOrdinal: number;
	readonly mappings: readonly MemberMapping[];
	readonly shared: ServiceRef;
}

type DiscoverPhaseOutcome =
	| { readonly discovered: DiscoveredGroup; readonly kind: "discovered" }
	| { readonly kind: "no-group" }
	| {
			readonly kind: "refused";
			readonly reason: "over-budget" | "unmappable-member";
	  };

const noopTier = (id: TierId): Tier => ({
	id,
	propose: () => ({ kind: "proposed", links: [] }),
});

const toDiscoverOutcome = (outcome: DiscoveryOutcome): DiscoverPhaseOutcome => {
	switch (outcome.kind) {
		case "discovered": {
			return {
				discovered: {
					anchorOrdinal: outcome.anchorOrdinal,
					mappings: outcome.mappings,
					shared: outcome.shared,
				},
				kind: "discovered",
			};
		}
		case "no-group": {
			return { kind: "no-group" };
		}
		case "refused": {
			return { kind: "refused", reason: outcome.reason };
		}
	}
};

const discoverGroup = async (
	input: DiscoverInput,
): Promise<DiscoverPhaseOutcome> => {
	const member = toGraphMember(input.anchor);
	const outcome = await discoverStructuralGroup({
		budget: input.budget,
		clients: input.clients,
		shared: member,
	});
	return toDiscoverOutcome(outcome);
};

interface FetchTargetInput {
	readonly clients: DiscoveryClients;
	readonly target: ServiceRef;
}

type FetchTargetOutcome =
	| { readonly enumerated: EnumeratedTitle; readonly kind: "fetched" }
	| { readonly kind: "unavailable" };

const instalmentEnumerableServices = new Set<string>(["anilist", "mal"]);

const fetchTargetStream = async (
	input: FetchTargetInput,
): Promise<FetchTargetOutcome> => {
	try {
		const enumerated = await input.clients.instalments.enumerate(input.target);
		if (
			!instalmentEnumerableServices.has(input.target.service) &&
			enumerated.stream.instalments.length === 0
		) {
			return { kind: "unavailable" };
		}
		return { enumerated, kind: "fetched" };
	} catch {
		return { kind: "unavailable" };
	}
};

const anchorStreamFromDb = async (
	db: Db,
	titleId: number,
): Promise<InstalmentStream> => {
	const spokes = await db
		.select()
		.from(serviceInstalments)
		.where(eq(serviceInstalments.titleId, titleId))
		.all();
	return {
		boundary: "complete",
		instalments: spokes.map((spoke) => ({
			kind: "regular" as const,
			locator: spoke.locator,
		})),
	};
};

const mergeFacts = (
	base: FactsByLocator,
	extra: FactsByLocator,
): FactsByLocator => {
	const merged = new Map<InstalmentLocator, InstalmentFacts>(base);
	for (const [locator, fact] of extra) {
		merged.set(locator, fact);
	}
	return merged;
};

interface AlignInput {
	readonly anchor: InstalmentStream;
	readonly anchorFacts?: FactsByLocator;
	readonly budget: number;
	readonly target: EnumeratedTitle;
}

interface AlignPhaseOutcome {
	readonly alignment?: AlignmentOutcome;
	readonly kind: "aligned" | "over-budget";
	readonly ladder: LadderResult;
}

const alignTarget = (input: AlignInput): AlignPhaseOutcome => {
	const budget = createBudget(input.budget);
	const anchorFacts = input.anchorFacts ?? new Map();
	const mergedFacts = mergeFacts(anchorFacts, input.target.facts);
	const tier3 = createTier3(mergedFacts);
	const ladder = runLadder({
		budget,
		left: input.anchor,
		right: input.target.stream,
		tiers: {
			t1: noopTier("t1-structure"),
			t2: noopTier("t2-pattern"),
			t3: tier3,
		},
	});
	if (ladder.outcome.status === "unmatched") {
		return { kind: "over-budget", ladder };
	}
	return { alignment: ladder.outcome, kind: "aligned", ladder };
};

const highestTriedTier = (ladder: LadderResult | undefined): TierId => {
	if (ladder === undefined) {
		return "t3-episode";
	}
	for (const tier of ["t3-episode", "t2-pattern", "t1-structure"] as const) {
		const contribution = ladder.contributions.find(
			(entry) => entry.tier === tier && entry.proposal.kind === "proposed",
		);
		if (contribution !== undefined) {
			return tier;
		}
	}
	return "t3-episode";
};

const targetMappingFor = (
	discovered: DiscoveredGroup,
	targetService: Service,
): MemberMapping | undefined =>
	discovered.mappings.find(
		(mapping) => mapping.member.service === targetService,
	);

const convergeMembersOf = (
	discovered: DiscoveredGroup,
): readonly {
	readonly ordinal: number;
	readonly service: string;
	readonly serviceId: string;
}[] => [
	{
		ordinal: discovered.anchorOrdinal,
		service: discovered.shared.service,
		serviceId: discovered.shared.serviceId,
	},
	...discovered.mappings.map((mapping) => ({
		ordinal: mapping.ordinal,
		service: mapping.member.service,
		serviceId: mapping.member.serviceId,
	})),
];

export {
	alignTarget,
	anchorStreamFromDb,
	convergeMembersOf,
	discoverGroup,
	fetchTargetStream,
	highestTriedTier,
	targetMappingFor,
};
export type {
	AlignInput,
	AlignPhaseOutcome,
	DiscoverInput,
	DiscoveredGroup,
	DiscoverPhaseOutcome,
	FetchTargetInput,
	FetchTargetOutcome,
};
