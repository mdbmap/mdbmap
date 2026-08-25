import type { Promisable } from "type-fest";

import type { InstalmentLocator } from "@/db/schema";
import { createBudget, createTier3, runLadder } from "@/engine/matcher";
import type {
	FactsByLocator,
	InstalmentFacts,
	InstalmentStream,
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

// A candidate title's own cross-service ids plus its live first-air date. The
// date orders members and is never persisted; only the derived `ordinal` is.
interface TitleDescriptor {
	readonly externalIds: readonly ServiceRef[];
	readonly firstAirDate: string | undefined;
}

// A title's instalment stream and the per-instalment facts the matcher scores
// on. Fetching this is the "enumeration" the shared budget charges for.
interface EnumeratedTitle {
	readonly facts: FactsByLocator;
	readonly stream: InstalmentStream;
}

// The `/find` on a shared external id lists every candidate title that names it.
interface FindClient {
	readonly find: (shared: ServiceRef) => Promisable<readonly ServiceRef[]>;
}

// A candidate's own `external_ids` (and live date), read to check it points back
// at the shared title before it may join.
interface ExternalIdsClient {
	readonly describe: (candidate: ServiceRef) => Promisable<TitleDescriptor>;
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
	// Cost charged for each title's instalment fetch. One request each by default.
	readonly enumerationCost?: number;
	readonly shared: ServiceRef;
}

// One pairing carried by a member's mapping: the shared title's instalments and
// the member's instalments that cover the same content, recording which member
// title each side belongs to (the member ref rides on the enclosing mapping).
interface MappedPair {
	readonly memberLocators: readonly InstalmentLocator[];
	readonly sharedLocators: readonly InstalmentLocator[];
}

// A joined member in its persisted position, with the pairs the matcher placed
// for it over whatever earlier members left unclaimed on the shared title.
interface MemberMapping {
	readonly member: ServiceRef;
	readonly ordinal: number;
	readonly pairs: readonly MappedPair[];
}

// A discovered, mapped group; a whole refusal that writes nothing (over budget);
// or no group at all, when no candidate's evidence pointed back.
type DiscoveryOutcome =
	| {
			readonly kind: "discovered";
			readonly mappings: readonly MemberMapping[];
			readonly shared: ServiceRef;
	  }
	| { readonly kind: "no-group" }
	| { readonly kind: "refused"; readonly reason: "over-budget" };

const sameRef = (first: ServiceRef, second: ServiceRef): boolean =>
	first.service === second.service && first.serviceId === second.serviceId;

// A candidate joins only when its own ids name the shared title back. A `/find`
// hit that lists no such id (one-sided) or names a different one (conflicting)
// attaches nothing.
const pointsBack = (
	descriptor: TitleDescriptor,
	shared: ServiceRef,
): boolean => descriptor.externalIds.some((external) => sameRef(external, shared));

interface OrderedMember {
	readonly firstAirDate: string | undefined;
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
// service then service id — so every member derives the same order whichever one
// the resolve started from, and the persisted ordinals never depend on the dates.
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
	if (first.ref.service !== second.ref.service) {
		return first.ref.service < second.ref.service ? -1 : 1;
	}
	if (first.ref.serviceId !== second.ref.serviceId) {
		return first.ref.serviceId < second.ref.serviceId ? -1 : 1;
	}
	return 0;
};

const noopTier = (id: TierId): Tier => ({ id, propose: () => ({ pairings: [] }) });

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

const publishedPairs = (result: LadderResult): readonly MappedPair[] => {
	const { outcome } = result;
	if (outcome.status !== "published") {
		return [];
	}
	return outcome.alignment.pairs.map((aligned) => ({
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

// The distinct `/find` candidates that are not the shared title itself.
const uniqueCandidates = (
	candidates: readonly ServiceRef[],
	shared: ServiceRef,
): readonly ServiceRef[] => {
	const unique: ServiceRef[] = [];
	const seen = new Set<string>();
	for (const candidate of candidates) {
		const key = `${candidate.service}:${candidate.serviceId}`;
		if (sameRef(candidate, shared) || seen.has(key)) {
			continue;
		}
		seen.add(key);
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
	const members = described
		.filter((entry) => pointsBack(entry.descriptor, shared))
		.map((entry) => ({
			firstAirDate: entry.descriptor.firstAirDate,
			ref: entry.candidate,
		}));
	return members.toSorted(byMemberOrder);
};

// Fetch the shared title and every member once, charging each fetch to the one
// shared budget. A fetch that will not fit refuses the whole group before any
// mapping, so a partial group is never enumerated.
interface Enumeration {
	readonly members: readonly { readonly enumerated: EnumeratedTitle; readonly member: OrderedMember }[];
	readonly shared: EnumeratedTitle;
}

const enumerateGroup = async (
	shared: ServiceRef,
	members: readonly OrderedMember[],
	clients: DiscoveryClients,
	limit: number,
	cost: number,
): Promise<Enumeration | undefined> => {
	// The whole group's enumeration is charged to one budget up front: a group
	// that will not fit is refused whole, so no member is ever fetched partially.
	const budget = createBudget(limit);
	if (!budget.spend(cost * (members.length + 1))) {
		return undefined;
	}
	const [sharedTitle, enumerated] = await Promise.all([
		clients.instalments.enumerate(shared),
		Promise.all(
			members.map(async (member) => ({
				enumerated: await clients.instalments.enumerate(member.ref),
				member,
			})),
		),
	]);
	return { members: enumerated, shared: sharedTitle };
};

const mapMembers = (enumeration: Enumeration): readonly MemberMapping[] => {
	const mappings: MemberMapping[] = [];
	let sharedStream = enumeration.shared.stream;
	for (const [ordinal, entry] of enumeration.members.entries()) {
		const facts = mergeFacts(enumeration.shared.facts, entry.enumerated.facts);
		const result = matchMember(sharedStream, entry.enumerated.stream, facts);
		const pairs = publishedPairs(result);
		mappings.push({ member: entry.member.ref, ordinal, pairs });
		const claimed = new Set<InstalmentLocator>();
		for (const pair of pairs) {
			for (const locator of pair.sharedLocators) {
				claimed.add(locator);
			}
		}
		sharedStream = remainingShared(sharedStream, claimed);
	}
	return mappings;
};

// Discover a structural group from a shared external id (ADR-0002). A `/find`
// lists every candidate; each joins only on two-sided `external_ids` evidence.
// The whole group's enumeration is charged to one budget and refused whole if it
// will not fit; otherwise the shared title is matched per member, in member
// order, over what earlier members left unclaimed.
const discoverStructuralGroup = async (
	input: DiscoveryInput,
): Promise<DiscoveryOutcome> => {
	const cost = input.enumerationCost ?? 1;
	const members = await gatherMembers(input.shared, input.clients);
	if (members.length === 0) {
		return { kind: "no-group" };
	}
	const enumeration = await enumerateGroup(
		input.shared,
		members,
		input.clients,
		input.budget,
		cost,
	);
	if (enumeration === undefined) {
		return { kind: "refused", reason: "over-budget" };
	}
	return {
		kind: "discovered",
		mappings: mapMembers(enumeration),
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
