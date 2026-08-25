import type {
	MainlineRelation,
	SimklClient,
	SimklEntry,
	SimklExternalIds,
	SimklRelation,
	SimklRelationKind,
} from "./simkl.ts";

// The continuity walk (ADR-0002 discovery). From a known SIMKL anime it walks
// explicit prequel links back and sequel links forward, fetching and checking
// each entry separately, and emits an ordered chain of segments the matcher
// consumes. Order derives from the directed edges; the cached ordinal is a
// build hint, never the source of truth. An ambiguous branch, a cycle-closing
// link or a non-anime candidate refuses to guess and yields a
// continuity-conflict instead.

// One title on the chain. Segment boundaries are soft evidence for the matcher;
// SIMKL's non-native ids ride along as candidates the target must still verify.
interface ChainSegment {
	entry: SimklEntry;
	externalIds: SimklExternalIds;
	nativeAnidbId: string | undefined;
	ordinal: number;
}

interface ContinuityChain {
	kind: "chain";
	// The earliest reachable mainline entry; matching rebases here once an entry
	// verifies. The request cursor stays with the broker, not the chain.
	rebase: ChainSegment;
	segments: readonly ChainSegment[];
}

type ContinuityConflictReason =
	| "ambiguous-branch"
	| "cycle-closing-link"
	| "non-anime-candidate";

interface CompetingSimklRelation {
	fromId: string;
	kind: SimklRelationKind;
	toId: string;
}

// The case the walk refused to resolve. Carried at the SIMKL grain (entry ids,
// not title ids); the verification step (#40) resolves it to title ids before
// persisting a `continuity-conflict` row.
interface ContinuityConflict {
	competing: readonly CompetingSimklRelation[];
	entryId: string;
	kind: "continuity-conflict";
	reason: ContinuityConflictReason;
}

type WalkResult = ContinuityChain | ContinuityConflict;

interface WalkDeps {
	fetchEntry: SimklClient["fetchEntry"];
}

const inDirection = (
	entry: SimklEntry,
	direction: MainlineRelation,
): readonly SimklRelation[] =>
	entry.relations.filter((relation) => relation.kind === direction);

const asCompeting = (
	entry: SimklEntry,
	relations: readonly SimklRelation[],
): CompetingSimklRelation[] =>
	relations.map((relation) => ({
		fromId: entry.id,
		kind: relation.kind,
		toId: relation.toId,
	}));

// Mainline relations are degree-1: at most one prequel and one sequel. Two of
// either is a same-direction branch the walk cannot linearise.
const branchConflict = (entry: SimklEntry): ContinuityConflict | undefined => {
	const prequels = inDirection(entry, "prequel");
	const sequels = inDirection(entry, "sequel");
	const branching = prequels.length > 1 ? prequels : sequels;
	if (branching.length <= 1) {
		return undefined;
	}
	return {
		competing: asCompeting(entry, branching),
		entryId: entry.id,
		kind: "continuity-conflict",
		reason: "ambiguous-branch",
	};
};

const edgeConflict = (
	entry: SimklEntry,
	edge: SimklRelation,
	reason: Exclude<ContinuityConflictReason, "ambiguous-branch">,
	entryId: string,
): ContinuityConflict => ({
	competing: asCompeting(entry, [edge]),
	entryId,
	kind: "continuity-conflict",
	reason,
});

interface Extension {
	conflict?: ContinuityConflict;
	entries: SimklEntry[];
}

// Follows the single mainline edge in `direction`, recursing until it stops at a
// boundary or refuses. Sequential by nature: each step's edges are only known
// once its entry is fetched. Entries come back nearest-first.
const extend = async (
	from: SimklEntry,
	direction: MainlineRelation,
	visited: Set<string>,
	deps: WalkDeps,
): Promise<Extension> => {
	const [edge] = inDirection(from, direction);
	if (edge === undefined) {
		return { entries: [] };
	}
	if (visited.has(edge.toId)) {
		return {
			conflict: edgeConflict(from, edge, "cycle-closing-link", from.id),
			entries: [],
		};
	}
	const next = await deps.fetchEntry(edge.toId);
	if (next === undefined) {
		return { entries: [] };
	}
	if (next.type !== "anime") {
		return {
			conflict: edgeConflict(from, edge, "non-anime-candidate", edge.toId),
			entries: [],
		};
	}
	const branch = branchConflict(next);
	if (branch !== undefined) {
		return { conflict: branch, entries: [] };
	}
	visited.add(next.id);
	const rest = await extend(next, direction, visited, deps);
	if (rest.conflict !== undefined) {
		return rest;
	}
	return { entries: [next, ...rest.entries] };
};

const segmentOf = (entry: SimklEntry, ordinal: number): ChainSegment => ({
	entry,
	externalIds: entry.externalIds,
	nativeAnidbId: entry.externalIds.anidb,
	ordinal,
});

const walkContinuity = async (
	start: SimklEntry,
	deps: WalkDeps,
): Promise<WalkResult> => {
	const startBranch = branchConflict(start);
	if (startBranch !== undefined) {
		return startBranch;
	}
	const visited = new Set<string>([start.id]);

	const back = await extend(start, "prequel", visited, deps);
	if (back.conflict !== undefined) {
		return back.conflict;
	}
	const forward = await extend(start, "sequel", visited, deps);
	if (forward.conflict !== undefined) {
		return forward.conflict;
	}

	const ordered = [...back.entries.toReversed(), start, ...forward.entries];
	const segments = ordered.map((entry, index) => segmentOf(entry, index));
	// The furthest-back prequel is the earliest reachable entry; with none, the
	// start is already the head of its mainline chain.
	const earliest = back.entries.at(-1) ?? start;
	return { kind: "chain", rebase: segmentOf(earliest, 0), segments };
};

export { walkContinuity };
export type {
	ChainSegment,
	CompetingSimklRelation,
	ContinuityChain,
	ContinuityConflict,
	ContinuityConflictReason,
	WalkDeps,
	WalkResult,
};
