import { objectKeys } from "ts-extras";

import { assertionSources } from "@/db/engine-schema";
import type {
	AssertionConfidence,
	AssertionSource,
	GroupSource,
} from "@/db/engine-schema";

import { formatId } from "./identity.ts";
import type { Identity, Service } from "./identity.ts";

// Grade of an established counterpart; the matcher never emits none/unmatched for
// a real link.
type LinkedConfidence = AssertionConfidence | "exact";
// Grade of a spoke with no counterpart, decided by ladder completeness.
type UnlinkedConfidence = "none" | "unmatched";
type MappingConfidence = LinkedConfidence | UnlinkedConfidence;

// One accepted assertion in a derivation path, carrying its provenance and grade.
interface PathAssertion {
	readonly confidence: AssertionConfidence;
	readonly source: AssertionSource;
}

// A resolved counterpart names a member title/instalment and the path that
// established it. The serializer formats the identity into a valid input id.
interface ResolvedCounterpart {
	readonly assertionPath: readonly PathAssertion[];
	readonly confidence: LinkedConfidence;
	readonly identity: Identity;
}

// One counterpart service either resolves to spokes or is a known no-counterpart
// whose grade depends on ladder completeness.
type ResolvedLink =
	| { readonly counterparts: readonly ResolvedCounterpart[]; readonly linked: true }
	| { readonly ladderComplete: boolean; readonly linked: false };

type ResolvedLinks = ReadonlyMap<Service, ResolvedLink>;

// An instalment of the requested title, in the request direction, with the source
// serving that instalment's mappings.
interface ResolvedInstalment {
	readonly input: Identity;
	readonly links: ResolvedLinks;
	readonly source: GroupSource;
}

interface InstalmentAnswer {
	readonly input: Identity;
	readonly kind: "instalment";
	readonly links: ResolvedLinks;
}

interface TitleAnswer {
	readonly groupSource: GroupSource;
	readonly input: Identity;
	readonly instalments: readonly ResolvedInstalment[];
	readonly kind: "title";
	readonly links: ResolvedLinks;
}

// The in-memory answer #33 feeds the serializer: no DB, no IO, fully resolved.
type ResolvedAnswer = InstalmentAnswer | TitleAnswer;

// A bare counterpart with its own grade and evidence path.
interface Counterpart {
	readonly assertionPath: readonly PathAssertion[];
	readonly confidence: LinkedConfidence;
	readonly id: string;
}

// A counterpart service's link. counterparts is always an array; [] is a known
// no-counterpart carrying none or unmatched.
interface Link {
	readonly confidence: MappingConfidence;
	readonly counterparts: readonly Counterpart[];
	readonly source: GroupSource | undefined;
}

type Mappings = Partial<Record<Service, Link>>;

interface InstalmentMapping {
	readonly input: string;
	readonly mappings: Mappings;
	readonly source: GroupSource;
}

interface MappingResponse {
	readonly input: string;
	readonly instalments?: readonly InstalmentMapping[];
	readonly mappings: Mappings;
}

// Legacy compact shape for Stremio adapters: bare counterpart ids plus a single
// top-level grade and source.
interface CompactResponse {
	readonly confidence: MappingConfidence;
	readonly input: string;
	readonly mappings: Partial<Record<Service, readonly string[]>>;
	readonly source: GroupSource | undefined;
}

const confidenceOrder = ["unmatched", "none", "low", "high", "exact"] as const;

const confidenceRank = (confidence: MappingConfidence): number =>
	confidenceOrder.indexOf(confidence);

const bestConfidence = (
	counterparts: readonly ResolvedCounterpart[],
): LinkedConfidence => {
	let best: LinkedConfidence | undefined;
	for (const counterpart of counterparts) {
		if (best === undefined || confidenceRank(counterpart.confidence) > confidenceRank(best)) {
			best = counterpart.confidence;
		}
	}
	return best ?? "low";
};

const sourceRank = (source: AssertionSource): number =>
	assertionSources.indexOf(source);

// "release" is structural, not curated, so it ranks below every tier.
const groupSourceRank = (source: GroupSource): number =>
	source === "release" ? -1 : sourceRank(source);

// The link's own source: the most-curated provenance across its assertions.
const ownSource = (
	counterparts: readonly ResolvedCounterpart[],
): AssertionSource | undefined => {
	let winner: AssertionSource | undefined;
	for (const counterpart of counterparts) {
		for (const assertion of counterpart.assertionPath) {
			if (winner === undefined || sourceRank(assertion.source) > sourceRank(winner)) {
				winner = assertion.source;
			}
		}
	}
	return winner;
};

// A title-level answer serves the derived group source; an instalment-level one
// serves the link's own, so groupSource is present only for the former.
const linkFor = (link: ResolvedLink, groupSource: GroupSource | undefined): Link => {
	if (!link.linked) {
		return {
			confidence: link.ladderComplete ? "none" : "unmatched",
			counterparts: [],
			source: undefined,
		};
	}
	const counterparts = link.counterparts.map((counterpart) => ({
		assertionPath: counterpart.assertionPath,
		confidence: counterpart.confidence,
		id: formatId(counterpart.identity),
	}));
	return {
		confidence: bestConfidence(link.counterparts),
		counterparts,
		source: groupSource ?? ownSource(link.counterparts),
	};
};

const mappingsFor = (links: ResolvedLinks, groupSource: GroupSource | undefined): Mappings => {
	const mappings: Mappings = {};
	for (const [service, link] of links) {
		mappings[service] = linkFor(link, groupSource);
	}
	return mappings;
};

const serialize = (answer: ResolvedAnswer): MappingResponse => {
	if (answer.kind === "instalment") {
		return { input: formatId(answer.input), mappings: mappingsFor(answer.links, undefined) };
	}
	return {
		input: formatId(answer.input),
		instalments: answer.instalments.map((instalment) => ({
			input: formatId(instalment.input),
			mappings: mappingsFor(instalment.links, instalment.source),
			source: instalment.source,
		})),
		mappings: mappingsFor(answer.links, answer.groupSource),
	};
};

const aggregateConfidence = (links: readonly Link[]): MappingConfidence => {
	let best: MappingConfidence | undefined;
	for (const link of links) {
		if (best === undefined || confidenceRank(link.confidence) > confidenceRank(best)) {
			best = link.confidence;
		}
	}
	return best ?? "unmatched";
};

const aggregateSource = (links: readonly Link[]): GroupSource | undefined => {
	let winner: GroupSource | undefined;
	for (const { source } of links) {
		if (source !== undefined && (winner === undefined || groupSourceRank(source) > groupSourceRank(winner))) {
			winner = source;
		}
	}
	return winner;
};

// Strip assertion evidence to bare counterpart ids and collapse the per-link
// grades and sources into the single legacy pair.
const toCompact = (response: MappingResponse): CompactResponse => {
	const mappings: Partial<Record<Service, readonly string[]>> = {};
	const links: Link[] = [];
	for (const service of objectKeys(response.mappings)) {
		const link = response.mappings[service];
		if (link === undefined) {
			continue;
		}
		mappings[service] = link.counterparts.map((counterpart) => counterpart.id);
		links.push(link);
	}
	return {
		confidence: aggregateConfidence(links),
		input: response.input,
		mappings,
		source: aggregateSource(links),
	};
};

export { serialize, toCompact };
export type {
	CompactResponse,
	Counterpart,
	InstalmentAnswer,
	InstalmentMapping,
	Link,
	LinkedConfidence,
	MappingConfidence,
	MappingResponse,
	Mappings,
	PathAssertion,
	ResolvedAnswer,
	ResolvedCounterpart,
	ResolvedInstalment,
	ResolvedLink,
	ResolvedLinks,
	TitleAnswer,
	UnlinkedConfidence,
};
