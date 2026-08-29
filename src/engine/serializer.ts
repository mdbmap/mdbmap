import { objectKeys } from "ts-extras";

import { assertionSources } from "@/db/engine-schema";
import type {
	AssertionConfidence,
	AssertionSource,
	GroupSource,
} from "@/db/engine-schema";

import { FormatError, formatId } from "./identity.ts";
import type { Identity, Service } from "./identity.ts";

// Grade of an established counterpart: exact is the external-id match, the ladder
// matcher adds high and low. Completion states are never confidence (ADR-0001).
type LinkedConfidence = AssertionConfidence | "exact";

type CompletionStatus =
	| "conflict"
	| "known-no-counterpart"
	| "pending"
	| "unmatched";

type LinkStatus = "matched" | CompletionStatus;

// One accepted assertion in a derivation path, carrying its provenance and grade.
interface PathAssertion {
	readonly confidence: AssertionConfidence;
	readonly source: AssertionSource;
}

// A resolved counterpart names a member title/instalment and the path that
// established it. supportingInstalment names the request-side instalment that
// backs a non-coextensive title-level link (ADR-0001).
interface ResolvedCounterpart {
	readonly assertionPath: readonly PathAssertion[];
	readonly confidence: LinkedConfidence;
	readonly identity: Identity;
	readonly supportingInstalment?: Identity;
}

// One counterpart service either resolves to spokes or sits in a completion
// state with no spokes.
type ResolvedLink =
	| {
			readonly counterparts: readonly ResolvedCounterpart[];
			readonly status: "matched";
	  }
	| { readonly status: CompletionStatus };

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

// The in-memory answer the serializer consumes: no DB, no IO, fully resolved.
// Precondition: the top-level input round-trips the parsed request id and is always
// representable. Per-instalment inputs come from the internal model and may not be.
type ResolvedAnswer = InstalmentAnswer | TitleAnswer;

// A bare counterpart with its own grade and evidence path. supportingInstalment
// names the request-side instalment backing a non-coextensive title-level link.
interface Counterpart {
	readonly assertionPath: readonly PathAssertion[];
	readonly confidence: LinkedConfidence;
	readonly id: string;
	readonly supportingInstalment?: string;
}

// A counterpart the matcher established but whose identity has no boundary id
// (ADR-0001); surfaced so one unrepresentable spoke never drops the whole link.
interface CounterpartError {
	readonly assertionPath: readonly PathAssertion[];
	readonly confidence: LinkedConfidence;
	readonly reason: string;
}

// A counterpart service that resolved to spokes: a confidence grade plus the
// formatted counterparts and any that could not be formatted.
interface MatchedLink {
	readonly confidence: LinkedConfidence;
	readonly counterparts: readonly Counterpart[];
	readonly errors: readonly CounterpartError[];
	readonly source: GroupSource | undefined;
	readonly status: "matched";
}

// A counterpart service with no spokes, carrying only its completion state.
// counterparts stays empty; status is the meaningful field.
interface CompletionLink {
	readonly counterparts: readonly Counterpart[];
	readonly status: CompletionStatus;
}

type Link = CompletionLink | MatchedLink;

type Mappings = Partial<Record<Service, Link>>;

interface InstalmentMapping {
	readonly input: string;
	readonly mappings: Mappings;
	readonly source: GroupSource;
}

// A request-side instalment whose identity has no boundary id (ADR-0001); surfaced
// so one unrepresentable instalment never aborts the whole multi-service response.
interface InstalmentError {
	readonly reason: string;
	readonly source: GroupSource;
}

interface MappingResponse {
	readonly continuityId?: number;
	readonly input: string;
	readonly instalmentErrors?: readonly InstalmentError[];
	readonly instalments?: readonly InstalmentMapping[];
	readonly mappings: Mappings;
}

// Legacy compact shape for Stremio adapters: bare counterpart ids plus a single
// top-level grade, completion status and source.
interface CompactResponse {
	readonly confidence: LinkedConfidence | undefined;
	readonly input: string;
	readonly mappings: Partial<Record<Service, readonly string[]>>;
	readonly source: GroupSource | undefined;
	readonly status: LinkStatus;
}

const maxBy = <Item>(
	items: Iterable<Item>,
	rank: (item: Item) => number,
): Item | undefined => {
	let best: Item | undefined;
	let bestRank = 0;
	for (const item of items) {
		const itemRank = rank(item);
		if (best === undefined || itemRank > bestRank) {
			best = item;
			bestRank = itemRank;
		}
	}
	return best;
};

const confidenceOrder = ["low", "high", "exact"] as const;

const confidenceRank = (confidence: LinkedConfidence): number =>
	confidenceOrder.indexOf(confidence);

const bestConfidence = (
	counterparts: readonly ResolvedCounterpart[],
): LinkedConfidence =>
	maxBy(counterparts, (counterpart) => confidenceRank(counterpart.confidence))
		?.confidence ?? "low";

const sourceRank = (source: AssertionSource): number =>
	assertionSources.indexOf(source);

// "release" is structural, not curated, so it ranks below every tier.
const groupSourceRank = (source: GroupSource): number =>
	source === "release" ? -1 : sourceRank(source);

// The link's own source: the most-curated provenance across its assertions.
const ownSource = (
	counterparts: readonly ResolvedCounterpart[],
): AssertionSource | undefined =>
	maxBy(
		counterparts.flatMap((counterpart) => counterpart.assertionPath),
		(assertion) => sourceRank(assertion.source),
	)?.source;

// formatId, but surfacing a FormatError as a value instead of throwing it.
const tryFormatId = (identity: Identity): FormatError | string => {
	try {
		return formatId(identity);
	} catch (error) {
		if (error instanceof FormatError) {
			return error;
		}
		throw error;
	}
};

const formatCounterpart = (
	counterpart: ResolvedCounterpart,
): Counterpart | { readonly error: CounterpartError } => {
	const evidence = {
		assertionPath: counterpart.assertionPath,
		confidence: counterpart.confidence,
	};
	const id = tryFormatId(counterpart.identity);
	if (id instanceof FormatError) {
		return { error: { ...evidence, reason: id.message } };
	}
	if (counterpart.supportingInstalment === undefined) {
		return { ...evidence, id };
	}
	const supportingInstalment = tryFormatId(counterpart.supportingInstalment);
	if (supportingInstalment instanceof FormatError) {
		return { error: { ...evidence, reason: supportingInstalment.message } };
	}
	return { ...evidence, id, supportingInstalment };
};

// A title-level answer serves the derived group source; an instalment-level one
// serves the link's own, so groupSource is present only for the former.
const linkFor = (
	link: ResolvedLink,
	groupSource: GroupSource | undefined,
): Link => {
	if (link.status !== "matched") {
		return { counterparts: [], status: link.status };
	}
	const counterparts: Counterpart[] = [];
	const errors: CounterpartError[] = [];
	for (const counterpart of link.counterparts) {
		const formatted = formatCounterpart(counterpart);
		if ("error" in formatted) {
			errors.push(formatted.error);
		} else {
			counterparts.push(formatted);
		}
	}
	return {
		confidence: bestConfidence(link.counterparts),
		counterparts,
		errors,
		source: groupSource ?? ownSource(link.counterparts),
		status: "matched",
	};
};

const mappingsFor = (
	links: ResolvedLinks,
	groupSource: GroupSource | undefined,
): Mappings => {
	const mappings: Mappings = {};
	for (const [service, link] of links) {
		mappings[service] = linkFor(link, groupSource);
	}
	return mappings;
};

interface SerializeOptions {
	readonly continuityId?: number;
}

const serialize = (
	answer: ResolvedAnswer,
	options: SerializeOptions = {},
): MappingResponse => {
	const continuity =
		options.continuityId === undefined
			? {}
			: { continuityId: options.continuityId };
	if (answer.kind === "instalment") {
		return {
			...continuity,
			input: formatId(answer.input),
			mappings: mappingsFor(answer.links, undefined),
		};
	}
	const instalments: InstalmentMapping[] = [];
	const instalmentErrors: InstalmentError[] = [];
	for (const instalment of answer.instalments) {
		const input = tryFormatId(instalment.input);
		if (input instanceof FormatError) {
			instalmentErrors.push({
				reason: input.message,
				source: instalment.source,
			});
			continue;
		}
		instalments.push({
			input,
			mappings: mappingsFor(instalment.links, instalment.source),
			source: instalment.source,
		});
	}
	return {
		...continuity,
		input: formatId(answer.input),
		...(instalmentErrors.length > 0 ? { instalmentErrors } : {}),
		instalments,
		mappings: mappingsFor(answer.links, answer.groupSource),
	};
};

const aggregateConfidence = (
	links: readonly Link[],
): LinkedConfidence | undefined =>
	maxBy(
		links.filter((link): link is MatchedLink => link.status === "matched"),
		(link) => confidenceRank(link.confidence),
	)?.confidence;

// Aggregate completion state, matched winning so any usable target reads as such.
const statusOrder = [
	"known-no-counterpart",
	"unmatched",
	"pending",
	"conflict",
	"matched",
] as const;

const aggregateStatus = (links: readonly Link[]): LinkStatus =>
	maxBy(links, (link) => statusOrder.indexOf(link.status))?.status ??
	"unmatched";

const aggregateSource = (links: readonly Link[]): GroupSource | undefined =>
	maxBy(
		links.flatMap((link) =>
			link.status === "matched" && link.source !== undefined
				? [link.source]
				: [],
		),
		groupSourceRank,
	);

// Strip assertion evidence to bare counterpart ids and collapse the per-link
// grades, statuses and sources into the single legacy triple. A service is emitted
// only when it resolved to ids or is a completed empty search, so [] stays reserved
// for known-no-counterpart (ADR-0001). A matched link whose spokes all failed to
// format has no ids to emit, so it is excluded from the aggregate too: otherwise a
// single such target would read as a success-shaped matched/exact triple.
const toCompact = (response: MappingResponse): CompactResponse => {
	const mappings: Partial<Record<Service, readonly string[]>> = {};
	const links: Link[] = [];
	for (const service of objectKeys(response.mappings)) {
		const link = response.mappings[service];
		if (
			link === undefined ||
			(link.status === "matched" && link.counterparts.length === 0)
		) {
			continue;
		}
		links.push(link);
		if (link.status === "known-no-counterpart") {
			mappings[service] = [];
		} else if (link.status === "matched") {
			mappings[service] = link.counterparts.map(
				(counterpart) => counterpart.id,
			);
		}
	}
	return {
		confidence: aggregateConfidence(links),
		input: response.input,
		mappings,
		source: aggregateSource(links),
		status: aggregateStatus(links),
	};
};

export { serialize, toCompact };
export type {
	CompactResponse,
	CompletionLink,
	CompletionStatus,
	Counterpart,
	CounterpartError,
	InstalmentAnswer,
	InstalmentError,
	InstalmentMapping,
	Link,
	LinkedConfidence,
	LinkStatus,
	MappingResponse,
	Mappings,
	MatchedLink,
	PathAssertion,
	ResolvedAnswer,
	ResolvedCounterpart,
	ResolvedInstalment,
	ResolvedLink,
	ResolvedLinks,
	TitleAnswer,
};
