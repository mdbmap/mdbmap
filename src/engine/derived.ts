// Derived mappings via a shared content unit (ADR-0002). Pure graph traversal:
// no DB, no IO. It answers an A->B request by following accepted instalment
// assertions through a hub content unit and never invents an A->B assertion.
// It produces the resolved answer the serializer formats.

import { assertionSources } from "@/db/engine-schema";
import type { AssertionConfidence, AssertionSource } from "@/db/engine-schema";

import type { Identity, Service } from "./identity.ts";
import type {
	InstalmentAnswer,
	PathAssertion,
	ResolvedCounterpart,
	ResolvedLink,
} from "./serializer.ts";

type UnitId = string;

// One accepted assertion that a service instalment covers a content unit,
// carrying its own confidence and provenance (ADR-0002).
interface UnitCoverage {
	readonly confidence: AssertionConfidence;
	readonly source: AssertionSource;
	readonly unitId: UnitId;
}

// A service instalment and the content units its accepted assertions cover. A
// regular instalment covers one unit; a verified merge covers several.
interface InstalmentNode {
	readonly coverage: readonly UnitCoverage[];
	readonly identity: Identity;
}

const confidenceRank = (confidence: AssertionConfidence): number =>
	confidence === "high" ? 1 : 0;

// The weakest assertion on a path sets the path's confidence (ADR-0002).
const pathConfidence = (path: readonly PathAssertion[]): AssertionConfidence =>
	path.some((assertion) => assertion.confidence === "low") ? "low" : "high";

const toPathAssertion = (coverage: UnitCoverage): PathAssertion => ({
	confidence: coverage.confidence,
	source: coverage.source,
});

// The most-curated provenance on a path, mirroring how the serializer derives a
// link's own source, so a tie-break here matches what it publishes.
const provenanceRank = (path: readonly PathAssertion[]): number =>
	Math.max(
		...path.map((assertion) => assertionSources.indexOf(assertion.source)),
	);

interface DerivedPath {
	readonly assertionPath: readonly PathAssertion[];
	readonly confidence: AssertionConfidence;
	readonly unitId: UnitId;
}

// ADR-0002 leaves ties unspecified; break them by provenance, then by unit, so
// the selected path never depends on coverage row order.
const isStrongerPath = (candidate: DerivedPath, best: DerivedPath): boolean => {
	const byConfidence =
		confidenceRank(candidate.confidence) - confidenceRank(best.confidence);
	if (byConfidence !== 0) {
		return byConfidence > 0;
	}
	const byProvenance =
		provenanceRank(candidate.assertionPath) -
		provenanceRank(best.assertionPath);
	if (byProvenance !== 0) {
		return byProvenance > 0;
	}
	return candidate.unitId < best.unitId;
};

// The strongest valid path from the source instalment to one target instalment
// through a shared unit. Each shared unit is a candidate path; the strongest
// wins (ADR-0002).
const derivePath = (
	sourceUnits: ReadonlyMap<UnitId, UnitCoverage>,
	target: InstalmentNode,
): DerivedPath | undefined => {
	let best: DerivedPath | undefined;
	for (const coverage of target.coverage) {
		const sourceCoverage = sourceUnits.get(coverage.unitId);
		if (sourceCoverage === undefined) {
			continue;
		}
		const assertionPath = [
			toPathAssertion(sourceCoverage),
			toPathAssertion(coverage),
		];
		const candidate: DerivedPath = {
			assertionPath,
			confidence: pathConfidence(assertionPath),
			unitId: coverage.unitId,
		};
		if (best === undefined || isStrongerPath(candidate, best)) {
			best = candidate;
		}
	}
	return best;
};

const locatorRank = (identity: Identity): readonly [number, number] =>
	identity.kind === "instalment"
		? [identity.locator.season, identity.locator.episode]
		: [0, 0];

// A runtime-independent relational order on ids (locale collation would vary
// across ICU versions, and these ids are digit strings).
const compareStrings = (left: string, right: string): number => {
	if (left < right) {
		return -1;
	}
	return left > right ? 1 : 0;
};

// Deterministic counterpart order, independent of pool order: member title,
// then position within it.
const compareCounterpart = (
	left: ResolvedCounterpart,
	right: ResolvedCounterpart,
): number => {
	const titleComparison = compareStrings(
		left.identity.title.id,
		right.identity.title.id,
	);
	if (titleComparison !== 0) {
		return titleComparison;
	}
	const [leftSeason, leftEpisode] = locatorRank(left.identity);
	const [rightSeason, rightEpisode] = locatorRank(right.identity);
	return leftSeason - rightSeason || leftEpisode - rightEpisode;
};

// Derive every counterpart in one target service for a source instalment: the
// array of every target instalment sharing a unit the source covers, each at
// its strongest valid path's confidence. Derivation is cross-service (ADR-0002),
// so the source's own service has no derived route — same-service overlap is
// direct split/merge, not a hub derivation. undefined also means no shared-unit
// route, which a caller answers with a direct comparison (out of scope).
const deriveLink = (
	source: InstalmentNode,
	pool: readonly InstalmentNode[],
	targetService: Service,
): ResolvedLink | undefined => {
	if (targetService === source.identity.title.service) {
		return undefined;
	}
	const sourceUnits = new Map(
		source.coverage.map((coverage) => [coverage.unitId, coverage] as const),
	);
	const counterparts: ResolvedCounterpart[] = [];
	for (const target of pool) {
		if (target.identity.title.service !== targetService) {
			continue;
		}
		const path = derivePath(sourceUnits, target);
		if (path === undefined) {
			continue;
		}
		counterparts.push({
			assertionPath: path.assertionPath,
			confidence: path.confidence,
			identity: target.identity,
		});
	}
	if (counterparts.length === 0) {
		return undefined;
	}
	return {
		counterparts: counterparts.toSorted(compareCounterpart),
		status: "matched",
	};
};

// The full instalment-level answer the serializer consumes: one derived link
// per target service that has a shared-unit route.
const deriveInstalment = (
	source: InstalmentNode,
	pool: readonly InstalmentNode[],
	targetServices: Iterable<Service>,
): InstalmentAnswer => {
	const links = new Map<Service, ResolvedLink>();
	for (const service of targetServices) {
		const link = deriveLink(source, pool, service);
		if (link !== undefined) {
			links.set(service, link);
		}
	}
	return { input: source.identity, kind: "instalment", links };
};

export { deriveInstalment, deriveLink };
export type { InstalmentNode, UnitCoverage, UnitId };
