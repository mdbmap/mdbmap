import type { Promisable } from "type-fest";

import type { AssertionConfidence } from "@/db/columns.ts";
import { dayDistance, titleSimilarity } from "@/engine/matcher/index.ts";
import type { ChainSegment, ContinuityChain } from "./walk.ts";
import type { SimklEntry, SimklService } from "./simkl.ts";

// SIMKL verification (ADR-0002 discovery, issue #40). SIMKL is a broker, not an
// authority: its native alignments must be checked against the real catalogues
// before they become accepted assertions. This module consumes the continuity
// walk's chain and produces title/relation assertion plans plus leftover
// candidate evidence and conflicts. It resolves nothing to stored title ids and
// writes nothing — #42 converge persists the plans, mapping each service ref to
// a service_title row and each conflict to a pending candidate.

// The verification seam. A real client talks to TVDB/TMDB/AniDB; tests mock it.
// A missing record answers `undefined`; the caller treats that as an
// unavailable check, never a contradiction.
interface CatalogueTitle {
	format: string | undefined;
	instalmentCount: number | undefined;
	releaseDate: string | undefined;
	title: string;
}

interface CatalogueClient {
	fetchTitle: (serviceId: string) => Promisable<CatalogueTitle | undefined>;
}

// One client per catalogue SIMKL can align natively, keyed by service. TV↔TVDB,
// film↔TMDB, anime↔AniDB anchor a segment's own identity; the requested target
// client verifies the candidate cross-references.
type VerificationClients = Partial<Record<SimklService, CatalogueClient>>;

interface ServiceRef {
	service: SimklService;
	serviceId: string;
}

// Which of a target title's instalments a SIMKL segment covers, 1-based
// inclusive. A single-segment alignment covers the whole target; a combined
// target that SIMKL keeps separate splits into one range per segment.
interface InstalmentRange {
	from: number;
	to: number;
}

interface TitleAssertionPlan {
	// The segment's verified native identity — the anchor side of the edge.
	anchor: ServiceRef;
	confidence: AssertionConfidence;
	flagged: boolean;
	segmentOrdinal: number;
	target: ServiceRef;
	targetRange: InstalmentRange;
}

// A directed mainline edge between two segment anchors. Degree-1: a two-sided
// edge is high; a one-sided edge (the far record names nothing back) is low and
// flagged for review.
interface RelationAssertionPlan {
	confidence: AssertionConfidence;
	flagged: boolean;
	from: ServiceRef;
	to: ServiceRef;
}

// A non-native external id the target catalogue must still verify (catalogues
// split seasons and cours differently). Not yet an assertion.
interface CandidateReference {
	segmentOrdinal: number;
	service: SimklService;
	serviceId: string;
}

type VerificationConflictReason =
	| "count-mismatch"
	| "date-mismatch";

// A FAILED check — a real contradiction, not missing evidence. Nothing
// publishes for the run; #42 queues it for review.
interface VerificationConflict {
	kind: "verification-conflict";
	reason: VerificationConflictReason;
	segmentOrdinals: readonly number[];
	target: ServiceRef;
}

interface VerificationResult {
	candidates: readonly CandidateReference[];
	conflicts: readonly VerificationConflict[];
	relationAssertions: readonly RelationAssertionPlan[];
	titleAssertions: readonly TitleAssertionPlan[];
}

interface VerifyDeps {
	clients: VerificationClients;
	target: SimklService;
}

// Every chain segment is anime-shaped (the walk guards it), but keeping the map
// explicit lets a future TV/film continuity anchor against its own catalogue.
const nativeServiceFor = (type: SimklEntry["type"]): SimklService => {
	if (type === "movie") {
		return "tmdb";
	}
	return type === "show" ? "tvdb" : "anidb";
};

// A segment paired with the native catalogue record that verifies its identity
// and supplies its instalment count and release date.
interface AnchoredSegment {
	anchor: ServiceRef | undefined;
	native: CatalogueTitle | undefined;
	segment: ChainSegment;
}

const anchorSegment = async (
	segment: ChainSegment,
	clients: VerificationClients,
): Promise<AnchoredSegment> => {
	const service = nativeServiceFor(segment.entry.type);
	const serviceId = segment.externalIds[service];
	const client = clients[service];
	if (serviceId === undefined || client === undefined) {
		return { anchor: undefined, native: undefined, segment };
	}
	const native = await client.fetchTitle(serviceId);
	if (native === undefined) {
		return { anchor: undefined, native: undefined, segment };
	}
	return { anchor: { service, serviceId }, native, segment };
};

const namesEdge = (
	entry: SimklEntry,
	kind: "prequel" | "sequel",
	toId: string,
): boolean =>
	entry.relations.some(
		(relation) => relation.kind === kind && relation.toId === toId,
	);

// A mainline edge is confirmed only when both records name each other — the
// earlier as sequel, the later as prequel. A one-sided edge is too weak to
// carry high confidence anywhere it is checked.
const twoSidedEdge = (earlier: SimklEntry, later: SimklEntry): boolean =>
	namesEdge(earlier, "sequel", later.id) && namesEdge(later, "prequel", earlier.id);

// Adjacent chain segments are joined by a mainline edge the walk already
// followed. The edge is high only when both records confirm it; a one-sided
// edge publishes low and is flagged.
const relationFor = (
	earlier: AnchoredSegment,
	later: AnchoredSegment,
): RelationAssertionPlan | undefined => {
	if (earlier.anchor === undefined || later.anchor === undefined) {
		return undefined;
	}
	const twoSided = twoSidedEdge(earlier.segment.entry, later.segment.entry);
	return {
		confidence: twoSided ? "high" : "low",
		flagged: !twoSided,
		from: earlier.anchor,
		to: later.anchor,
	};
};

const relationsOf = (
	anchored: readonly AnchoredSegment[],
): RelationAssertionPlan[] => {
	const relations: RelationAssertionPlan[] = [];
	for (let index = 1; index < anchored.length; index += 1) {
		const earlier = anchored[index - 1];
		const later = anchored[index];
		if (earlier === undefined || later === undefined) {
			continue;
		}
		const relation = relationFor(earlier, later);
		if (relation !== undefined) {
			relations.push(relation);
		}
	}
	return relations;
};

// A maximal run of adjacent segments that carry the same target id, kept
// separate by SIMKL. Verification checks the target against the run as a whole
// before dividing its instalments between the segments. A run only extends over
// chain-adjacent segments: an intervening segment without the id (or with a
// different one) closes it, so a repeat that skips a gap stays two runs and its
// instalments are never laid end to end across the gap.
interface TargetRun {
	segments: readonly AnchoredSegment[];
	targetId: string;
}

const targetRuns = (
	anchored: readonly AnchoredSegment[],
	target: SimklService,
): TargetRun[] => {
	const runs: TargetRun[] = [];
	let previousOrdinal: number | undefined;
	for (const item of anchored) {
		const service = nativeServiceFor(item.segment.entry.type);
		const targetId = item.segment.externalIds[target];
		if (targetId === undefined || service === target) {
			previousOrdinal = undefined;
			continue;
		}
		const open = runs.at(-1);
		const adjacent =
			previousOrdinal !== undefined && item.segment.ordinal === previousOrdinal + 1;
		if (open !== undefined && open.targetId === targetId && adjacent) {
			open.segments = [...open.segments, item];
		} else {
			runs.push({ segments: [item], targetId });
		}
		previousOrdinal = item.segment.ordinal;
	}
	return runs;
};

const candidatesOf = (run: TargetRun, target: SimklService): CandidateReference[] =>
	run.segments.map((item) => ({
		segmentOrdinal: item.segment.ordinal,
		service: target,
		serviceId: run.targetId,
	}));

const DATE_TOLERANCE_DAYS = 366;
const TITLE_AGREEMENT = 0.5;

type CheckVerdict = "fail" | "pass" | "unavailable";

const dateVerdict = (
	nativeDate: string | undefined,
	targetDate: string | undefined,
): CheckVerdict => {
	if (nativeDate === undefined || targetDate === undefined) {
		return "unavailable";
	}
	const distance = dayDistance(nativeDate, targetDate);
	if (distance === undefined) {
		return "unavailable";
	}
	return distance <= DATE_TOLERANCE_DAYS ? "pass" : "fail";
};

const titleVerdict = (run: TargetRun, targetTitle: string): CheckVerdict => {
	let best = 0;
	for (const item of run.segments) {
		const native = item.native?.title;
		if (native !== undefined) {
			best = Math.max(best, titleSimilarity(native, targetTitle));
		}
	}
	return best >= TITLE_AGREEMENT ? "pass" : "unavailable";
};

// Format is corroboration, never contradiction: a shared shape (both `tv`, both
// `ona`) supports the alignment, but a mismatch across catalogues that name
// shapes differently is absent evidence, not a conflict.
const formatVerdict = (run: TargetRun, targetFormat: string | undefined): CheckVerdict => {
	if (targetFormat === undefined) {
		return "unavailable";
	}
	const wanted = targetFormat.toLowerCase();
	const agrees = run.segments.some((item) => item.native?.format?.toLowerCase() === wanted);
	return agrees ? "pass" : "unavailable";
};

// Neighbouring-relation evidence: a combined run only earns this signal when
// every SIMKL segment it merges is joined to the next by a confirmed two-sided
// mainline edge, so the catalogue's own adjacency backs the merge. A lone
// segment has no internal neighbour and a one-sided edge is too weak to count.
const relationVerdict = (run: TargetRun): CheckVerdict => {
	if (run.segments.length < 2) {
		return "unavailable";
	}
	for (let index = 1; index < run.segments.length; index += 1) {
		const earlier = run.segments[index - 1]?.segment.entry;
		const later = run.segments[index]?.segment.entry;
		if (earlier === undefined || later === undefined || !twoSidedEdge(earlier, later)) {
			return "unavailable";
		}
	}
	return "pass";
};

// Segment sizes drive the target's instalment split, so a run only verifies
// structurally when every segment has a native count and they sum to the
// target's own count. A sum that disagrees is a conflict, not weak evidence.
const countVerdict = (sum: number | undefined, total: number | undefined): CheckVerdict => {
	if (sum === undefined || total === undefined) {
		return "unavailable";
	}
	return sum === total ? "pass" : "fail";
};

const sizesOf = (run: TargetRun): readonly (number | undefined)[] =>
	run.segments.map((item) => item.native?.instalmentCount);

const sumOf = (sizes: readonly (number | undefined)[]): number | undefined => {
	let running = 0;
	for (const size of sizes) {
		if (size === undefined) {
			return undefined;
		}
		running += size;
	}
	return running;
};

// Lays the run's segments end to end across the target's instalments. Only
// called once the counts verify, so the ranges partition [1, total] exactly.
const rangesOf = (sizes: readonly number[]): InstalmentRange[] => {
	let cursor = 1;
	return sizes.map((size) => {
		const from = cursor;
		const to = from + size - 1;
		cursor = to + 1;
		return { from, to };
	});
};

const conflictOf = (
	run: TargetRun,
	target: SimklService,
	reason: VerificationConflictReason,
): VerificationConflict => ({
	kind: "verification-conflict",
	reason,
	segmentOrdinals: run.segments.map((item) => item.segment.ordinal),
	target: { service: target, serviceId: run.targetId },
});

const assertionsOf = (
	run: TargetRun,
	target: SimklService,
	ranges: readonly InstalmentRange[],
	confidence: AssertionConfidence,
): TitleAssertionPlan[] =>
	run.segments.flatMap((item, index) => {
		const { anchor } = item;
		const targetRange = ranges[index];
		if (anchor === undefined || targetRange === undefined) {
			return [];
		}
		return [
			{
				anchor,
				confidence,
				flagged: confidence === "low",
				segmentOrdinal: item.segment.ordinal,
				target: { service: target, serviceId: run.targetId },
				targetRange,
			},
		];
	});

interface RunOutcome {
	candidates: CandidateReference[];
	conflicts: VerificationConflict[];
	titleAssertions: TitleAssertionPlan[];
}

const empty = (): RunOutcome => ({
	candidates: [],
	conflicts: [],
	titleAssertions: [],
});

const verifyRun = async (
	run: TargetRun,
	deps: VerifyDeps,
): Promise<RunOutcome> => {
	const { clients, target } = deps;
	const client = clients[target];
	if (client === undefined) {
		return { ...empty(), candidates: candidatesOf(run, target) };
	}
	const targetTitle = await client.fetchTitle(run.targetId);
	if (targetTitle === undefined) {
		return { ...empty(), candidates: candidatesOf(run, target) };
	}

	const sizes = sizesOf(run);
	const counts = countVerdict(sumOf(sizes), targetTitle.instalmentCount);
	const dates = dateVerdict(run.segments[0]?.native?.releaseDate, targetTitle.releaseDate);
	if (counts === "fail") {
		return { ...empty(), conflicts: [conflictOf(run, target, "count-mismatch")] };
	}
	if (dates === "fail") {
		return { ...empty(), conflicts: [conflictOf(run, target, "date-mismatch")] };
	}

	// Without the counts to divide the target there is nothing to split on, so
	// the ids stay candidates the target must confirm.
	if (counts !== "pass") {
		return { ...empty(), candidates: candidatesOf(run, target) };
	}

	// Structural fit is evidence, not proof: an exact combined count reaches high
	// only with an independent signal — title, date, format or neighbouring
	// relation — agreeing. Without one it still publishes, but low and flagged.
	const corroborated =
		dates === "pass" ||
		titleVerdict(run, targetTitle.title) === "pass" ||
		formatVerdict(run, targetTitle.format) === "pass" ||
		relationVerdict(run) === "pass";
	const ranges = rangesOf(sizes.filter((size) => size !== undefined));
	return {
		...empty(),
		titleAssertions: assertionsOf(run, target, ranges, corroborated ? "high" : "low"),
	};
};

const verifyChain = async (
	chain: ContinuityChain,
	deps: VerifyDeps,
): Promise<VerificationResult> => {
	const anchored = await Promise.all(
		chain.segments.map(async (segment) => {
			const item = await anchorSegment(segment, deps.clients);
			return item;
		}),
	);

	const outcomes = await Promise.all(
		targetRuns(anchored, deps.target).map(async (run) => {
			const outcome = await verifyRun(run, deps);
			return outcome;
		}),
	);

	return {
		candidates: outcomes.flatMap((outcome) => outcome.candidates),
		conflicts: outcomes.flatMap((outcome) => outcome.conflicts),
		relationAssertions: relationsOf(anchored),
		titleAssertions: outcomes.flatMap((outcome) => outcome.titleAssertions),
	};
};

export { verifyChain };
export type {
	CandidateReference,
	CatalogueClient,
	CatalogueTitle,
	InstalmentRange,
	RelationAssertionPlan,
	ServiceRef,
	TitleAssertionPlan,
	VerificationClients,
	VerificationConflict,
	VerificationConflictReason,
	VerificationResult,
	VerifyDeps,
};
