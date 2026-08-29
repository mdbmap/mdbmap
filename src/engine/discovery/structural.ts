import type { Promisable } from "type-fest";

import type { AssertionConfidence } from "@/db/columns";
import type { InstalmentLocator } from "@/db/schema";
import { isNotEnumerableServiceError } from "@/engine/ingest/not-enumerable.ts";
import { createBudget, createTier3, runLadder } from "@/engine/matcher";
import type {
	FactsByLocator,
	InstalmentStream,
	InstalmentFacts,
	LadderResult,
	Tier,
	TierId,
} from "@/engine/matcher";

// A service's record of a title, e.g. imdb/tt2205133 or tmdb/40733. The shared
// external id a discovery starts from and every candidate it enumerates are the
// same shape, so the resolve reads identically whichever service began it.
interface ServiceRef {
	readonly service: string;
	readonly serviceId: string;
}

// A title's own cross-service ids plus its live first-air date. The date orders
// members and is never persisted; only the derived `ordinal` is.
interface TitleDescriptor {
	readonly externalIds: readonly ServiceRef[];
	readonly firstAirDate: string | undefined;
}

// A title's instalment stream and the per-instalment facts the matcher scores
// on. Fetching this is the "enumeration" the shared budget charges for. Locators
// must be unique across a title and the shared title it maps against — the
// matcher's own per-alignment requirement — since facts merge by locator.
interface EnumeratedTitle {
	readonly facts: FactsByLocator;
	readonly stream: InstalmentStream;
}

// The `/find` on a shared external id lists every candidate title that names it.
interface FindClient {
	readonly find: (shared: ServiceRef) => Promisable<readonly ServiceRef[]>;
}

// A title's own `external_ids` (and live date), read to check a candidate points
// back at the shared title and to place the anchor in member order.
interface ExternalIdsClient {
	readonly describe: (title: ServiceRef) => Promisable<TitleDescriptor>;
}

// Fetches a title's instalment list. The shared title is fetched once and every
// member once; each fetch is charged against the shared request budget.
interface InstalmentsClient {
	readonly enumerate: (title: ServiceRef) => Promisable<EnumeratedTitle>;
}

interface DiscoveryClients {
	readonly externalIds: ExternalIdsClient;
	readonly find: FindClient;
	readonly instalments: InstalmentsClient;
}

interface DiscoveryInput {
	readonly budget: number;
	readonly clients: DiscoveryClients;
	readonly shared: ServiceRef;
}

// One pairing carried by a member's mapping: the shared title's instalments and
// the member's instalments that cover the same content, recording which member
// title each side belongs to (the member ref rides on the enclosing mapping).
// Per-link confidence and provenance are out of scope here; the persistence path
// reads them from the matcher's own per-link output.
interface MappedPair {
	readonly confidence: AssertionConfidence;
	readonly memberLocators: readonly InstalmentLocator[];
	readonly sharedLocators: readonly InstalmentLocator[];
}

// A mapped member in its persisted position, with the pairs the matcher placed
// for it over whatever earlier members left unclaimed on the shared title.
interface MemberMapping {
	readonly member: ServiceRef;
	readonly ordinal: number;
	readonly pairs: readonly MappedPair[];
}

// A discovered, mapped group carries the anchor's own ordinal so the whole
// group's order is reproducible from ordinals alone. A refusal writes nothing:
// the group's enumeration did not fit one budget, or a member could not be
// mapped at all — a partial group is a wrong group, not a smaller one. `no-group`
// means no candidate's evidence pointed back.
type DiscoveryOutcome =
	| {
			readonly anchorOrdinal: number;
			readonly kind: "discovered";
			readonly mappings: readonly MemberMapping[];
			readonly shared: ServiceRef;
	  }
	| { readonly kind: "no-group" }
	| {
			readonly kind: "refused";
			readonly reason: "over-budget" | "unmappable-member";
	  };

const sameRef = (first: ServiceRef, second: ServiceRef): boolean =>
	first.service === second.service && first.serviceId === second.serviceId;

// A candidate joins only when its own ids name the shared title back. A `/find`
// hit that lists no such id (one-sided) or names a different one (conflicting)
// attaches nothing.
const pointsBack = (descriptor: TitleDescriptor, shared: ServiceRef): boolean =>
	descriptor.externalIds.some((external) => sameRef(external, shared));

interface OrderedMember {
	readonly firstAirDate: string | undefined;
	readonly ref: ServiceRef;
}

interface MemberTarget {
	readonly ordinal: number;
	readonly ref: ServiceRef;
}

// A parseable date orders ascending; an absent or unparseable one is dateless and
// sorts after every dated member.
const timeOf = (date: string | undefined): number | undefined => {
	if (date === undefined) {
		return undefined;
	}
	const parsed = Date.parse(date);
	return Number.isNaN(parsed) ? undefined : parsed;
};

// Member order: live first-air date ascending, dateless last, ties broken by
// service id (ADR-0002), then by service so a cross-service id collision still
// resolves — so every member derives the same order whichever one the resolve
// started from, and the persisted ordinals never depend on the dates.
const byMemberOrder = (first: OrderedMember, second: OrderedMember): number => {
	const firstTime = timeOf(first.firstAirDate);
	const secondTime = timeOf(second.firstAirDate);
	if (firstTime !== secondTime) {
		if (firstTime === undefined) {
			return 1;
		}
		if (secondTime === undefined) {
			return -1;
		}
		return firstTime - secondTime;
	}
	if (first.ref.serviceId !== second.ref.serviceId) {
		return first.ref.serviceId < second.ref.serviceId ? -1 : 1;
	}
	if (first.ref.service !== second.ref.service) {
		return first.ref.service < second.ref.service ? -1 : 1;
	}
	return 0;
};

const noopTier = (id: TierId): Tier => ({
	id,
	propose: () => ({ kind: "proposed", links: [] }),
});

// Run the deterministic matcher for one member against the shared title. T1/T2
// need segment structure the discovery path does not carry, so this leans on T3,
// which always runs and scores instalments on their own facts.
const matchMember = (
	shared: InstalmentStream,
	member: InstalmentStream,
	facts: FactsByLocator,
): LadderResult =>
	runLadder({
		budget: createBudget(0),
		left: shared,
		right: member,
		tiers: {
			t1: noopTier("t1-structure"),
			t2: noopTier("t2-pattern"),
			t3: createTier3(facts),
		},
	});

// The placed pairs for a member, or `undefined` when the alignment could not
// publish at all — a conflict or a truncated fetch, distinct from a member that
// published no pairs.
const publishedPairs = (
	result: LadderResult,
): readonly MappedPair[] | undefined => {
	const { outcome } = result;
	if (outcome.status !== "published") {
		return undefined;
	}
	return outcome.alignment.pairs.map((aligned) => ({
		confidence: aligned.confidence,
		memberLocators: aligned.right,
		sharedLocators: aligned.left,
	}));
};

// The shared title's instalments earlier members already claimed drop out, so a
// later member maps over what is left — letting it own a late segment.
const remainingShared = (
	stream: InstalmentStream,
	claimed: ReadonlySet<InstalmentLocator>,
): InstalmentStream => ({
	boundary: stream.boundary,
	instalments: stream.instalments.filter(
		(instalment) => !claimed.has(instalment.locator),
	),
});

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

// The distinct `/find` candidates that are not the shared title itself. Candidate
// lists are a handful of titles, so `sameRef` alone carries identity — no second
// key encoding to keep in step with it.
const uniqueCandidates = (
	candidates: readonly ServiceRef[],
	shared: ServiceRef,
): readonly ServiceRef[] => {
	const unique: ServiceRef[] = [];
	for (const candidate of candidates) {
		if (
			sameRef(candidate, shared) ||
			unique.some((seen) => sameRef(seen, candidate))
		) {
			continue;
		}
		unique.push(candidate);
	}
	return unique;
};

// Collect the candidates whose evidence points back at the shared title, tagged
// with the live date that orders them.
const gatherMembers = async (
	shared: ServiceRef,
	clients: DiscoveryClients,
): Promise<readonly OrderedMember[]> => {
	const candidates = uniqueCandidates(await clients.find.find(shared), shared);
	const described = await Promise.all(
		candidates.map(async (candidate) => ({
			candidate,
			descriptor: await clients.externalIds.describe(candidate),
		})),
	);
	return described
		.filter((entry) => pointsBack(entry.descriptor, shared))
		.map((entry) => ({
			firstAirDate: entry.descriptor.firstAirDate,
			ref: entry.candidate,
		}));
};

// Order the anchor alongside its members and hand back the anchor's own ordinal
// plus each member's — one deterministic slot per title in the group.
interface OrderedGroup {
	readonly anchorOrdinal: number;
	readonly members: readonly MemberTarget[];
}

const orderGroup = (
	anchor: OrderedMember,
	members: readonly OrderedMember[],
): OrderedGroup => {
	const ordered = [anchor, ...members].toSorted(byMemberOrder);
	const anchorOrdinal = ordered.findIndex((entry) =>
		sameRef(entry.ref, anchor.ref),
	);
	const targets = ordered
		.map((entry, ordinal) => ({ ordinal, ref: entry.ref }))
		.filter((target) => !sameRef(target.ref, anchor.ref));
	return { anchorOrdinal, members: targets };
};

interface EnumeratedMember {
	readonly enumerated: EnumeratedTitle;
	readonly ordinal: number;
	readonly ref: ServiceRef;
}

interface Enumeration {
	readonly members: readonly EnumeratedMember[];
	readonly shared: EnumeratedTitle;
}

interface EnumerateInput {
	readonly budget: number;
	readonly clients: DiscoveryClients;
	readonly members: readonly MemberTarget[];
	readonly shared: ServiceRef;
}

// Fetch the shared title and every member once, charging each fetch to the one
// shared budget, and refuse before any fetch when the group will not fit.
type EnumerateOutcome =
	| { readonly enumeration: Enumeration; readonly kind: "enumerated" }
	| { readonly kind: "not-enumerable" }
	| { readonly kind: "over-budget" };

const enumerateOne = async (
	clients: DiscoveryClients,
	title: ServiceRef,
): Promise<EnumeratedTitle | "not-enumerable"> => {
	try {
		return await clients.instalments.enumerate(title);
	} catch (error) {
		if (!isNotEnumerableServiceError(error)) {
			throw error;
		}
		return "not-enumerable";
	}
};

const enumerateGroup = async (
	input: EnumerateInput,
): Promise<EnumerateOutcome> => {
	const budget = createBudget(input.budget);
	if (!budget.spend(input.members.length + 1)) {
		return { kind: "over-budget" };
	}
	const [shared, members] = await Promise.all([
		enumerateOne(input.clients, input.shared),
		Promise.all(
			input.members.map(async (target) => {
				const enumerated = await enumerateOne(input.clients, target.ref);
				if (enumerated === "not-enumerable") {
					return "not-enumerable" as const;
				}
				return {
					enumerated,
					ordinal: target.ordinal,
					ref: target.ref,
				};
			}),
		),
	]);
	if (shared === "not-enumerable") {
		return { kind: "not-enumerable" };
	}
	const enumeratedMembers: EnumeratedMember[] = [];
	for (const member of members) {
		if (member === "not-enumerable") {
			return { kind: "not-enumerable" };
		}
		enumeratedMembers.push(member);
	}
	return {
		enumeration: { members: enumeratedMembers, shared },
		kind: "enumerated",
	};
};

type MapResult =
	| { readonly kind: "mapped"; readonly mappings: readonly MemberMapping[] }
	| { readonly kind: "unmappable" };

const mapMembers = (enumeration: Enumeration): MapResult => {
	const mappings: MemberMapping[] = [];
	let sharedStream = enumeration.shared.stream;
	for (const member of enumeration.members) {
		const facts = mergeFacts(enumeration.shared.facts, member.enumerated.facts);
		const pairs = publishedPairs(
			matchMember(sharedStream, member.enumerated.stream, facts),
		);
		if (pairs === undefined) {
			return { kind: "unmappable" };
		}
		mappings.push({ member: member.ref, ordinal: member.ordinal, pairs });
		const claimed = new Set<InstalmentLocator>();
		for (const pair of pairs) {
			for (const locator of pair.sharedLocators) {
				claimed.add(locator);
			}
		}
		sharedStream = remainingShared(sharedStream, claimed);
	}
	return { kind: "mapped", mappings };
};

// Discover a structural group from a shared external id (ADR-0002). A `/find`
// lists every candidate; each joins only on two-sided `external_ids` evidence.
// The whole group's enumeration is charged to one budget, and both an over-budget
// group and a member that cannot be mapped are refused whole and write nothing —
// a partial group is a wrong group. Otherwise the shared title is matched per
// member, in member order, over what earlier members left unclaimed.
const discoverStructuralGroup = async (
	input: DiscoveryInput,
): Promise<DiscoveryOutcome> => {
	const members = await gatherMembers(input.shared, input.clients);
	if (members.length === 0) {
		return { kind: "no-group" };
	}
	const anchor = await input.clients.externalIds.describe(input.shared);
	const ordered = orderGroup(
		{ firstAirDate: anchor.firstAirDate, ref: input.shared },
		members,
	);
	const enumeration = await enumerateGroup({
		budget: input.budget,
		clients: input.clients,
		members: ordered.members,
		shared: input.shared,
	});
	if (enumeration.kind === "over-budget") {
		return { kind: "refused", reason: "over-budget" };
	}
	if (enumeration.kind === "not-enumerable") {
		return { kind: "refused", reason: "unmappable-member" };
	}
	const mapped = mapMembers(enumeration.enumeration);
	if (mapped.kind === "unmappable") {
		return { kind: "refused", reason: "unmappable-member" };
	}
	return {
		anchorOrdinal: ordered.anchorOrdinal,
		kind: "discovered",
		mappings: mapped.mappings,
		shared: input.shared,
	};
};

export { discoverStructuralGroup };
export type {
	DiscoveryClients,
	DiscoveryInput,
	DiscoveryOutcome,
	EnumeratedTitle,
	ExternalIdsClient,
	FindClient,
	InstalmentsClient,
	MappedPair,
	MemberMapping,
	ServiceRef,
	TitleDescriptor,
};
