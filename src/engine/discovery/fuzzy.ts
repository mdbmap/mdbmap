import { and, eq } from "drizzle-orm";
import type { Promisable } from "type-fest";

import {
	candidateSubjectKey,
	pendingGroupCandidates,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import type {
	CandidateEvidence,
	CandidateSubject,
	Service,
} from "@/db/engine-schema";
import { survivorGroupId } from "@/engine/gateway";
import type { GatewayDb } from "@/engine/gateway";
import { titleSimilarity } from "@/engine/matcher";

// Fuzzy candidates (ADR-0002 §Fuzzy candidates, issue #43). The last-resort
// discovery when exact evidence leaves a title unpaired: search both services by
// the title and year the compute already paid for and queue what clears the bar
// as a `fuzzy-group` candidate for an admin. It never changes membership — the
// resolve answers exactly as it would without any search. Accepting is what
// makes it real; this module runs entirely behind mocked search clients and is
// the `background` closure a cache miss chains after persisting.

// Title similarity carries most of the weight; year agreement corroborates it. A
// disagreeing year (more than `YEAR_TOLERANCE` apart) scores zero on the year
// term, so `TITLE_WEIGHT` alone caps a perfect title below the bar — a mismatched
// year sinks a hit whatever its title. A missing year drops the term entirely
// (absent evidence, not disagreement) and leans on the title alone.
const TITLE_WEIGHT = 0.6;
const YEAR_WEIGHT = 0.4;
const MEMBER_BAR = 0.7;
const YEAR_TOLERANCE = 1;

// One request per service returns a capped result set; among the hits that clear
// the bar, only the first few become proposed members and the rest are surfaced
// as review context ("over the cap") rather than silently attached.
const RESULT_CAP = 8;
const MEMBER_CAP = 2;

// The evidence schema records an absent year as JSON `null`; the repo lint forbids
// the `null` token, so the one null the buckets need is parsed from JSON here.
const jsonNull = ((): null => {
	const parsed: unknown = JSON.parse("null");
	if (parsed === null) {
		return parsed;
	}
	throw new Error("JSON null must parse to null");
})();

const toStoredYear = (year: number | undefined): number | null => year ?? jsonNull;

type FuzzyGroupEvidence = Extract<CandidateEvidence, { kind: "fuzzy-group" }>;
type StoredHit = FuzzyGroupEvidence["proposedMembers"][number];
type StoredQuery = FuzzyGroupEvidence["queries"][number];

// The title and year the compute paid for, per service. Absent year is
// `undefined` here (the repo convention); it becomes JSON null only at the
// evidence boundary.
interface FuzzyQuery {
	readonly service: Service;
	readonly title: string;
	readonly year: number | undefined;
}

// One hit from a service's title search. The service is the client's own, so a
// result carries only its id, title and year.
interface FuzzySearchResult {
	readonly serviceId: string;
	readonly title: string;
	readonly year: number | undefined;
}

// The search seam. A real client talks to a service's search endpoint; tests mock
// it. One `search` is one request; the caller caps the result set.
interface FuzzySearchClient {
	readonly search: (
		title: string,
		year: number | undefined,
	) => Promisable<readonly FuzzySearchResult[]>;
}

type FuzzySearchClients = Partial<Record<Service, FuzzySearchClient>>;

interface FuzzyDiscoveryInput {
	readonly queries: readonly FuzzyQuery[];
	readonly subjectTitleId: number;
}

interface FuzzyDiscoveryDeps {
	readonly clients: FuzzySearchClients;
}

// A queued row (a new open row, or `undefined` when a repeat/concurrent discovery
// coalesced onto the existing one); a prior rejection of the same proposal
// suppressing the queue; nothing clearing the bar; or no stored subject.
type FuzzyDiscoveryOutcome =
	| {
			readonly candidateId: number | undefined;
			readonly evidence: FuzzyGroupEvidence;
			readonly kind: "queued";
	  }
	| { readonly evidence: FuzzyGroupEvidence; readonly kind: "suppressed" }
	| { readonly kind: "no-proposal" }
	| { readonly kind: "no-subject" };

interface ServiceRef {
	readonly service: Service;
	readonly serviceId: string;
}

interface ScoredHit extends ServiceRef {
	readonly score: number;
	readonly title: string;
	readonly year: number | undefined;
}

type FuzzyAcceptOutcome =
	| {
			readonly attachedTitleIds: readonly number[];
			readonly groupId: number;
			readonly kind: "accepted";
			readonly refused: readonly ServiceRef[];
	  }
	| { readonly kind: "missing" }
	| { readonly kind: "no-subject" }
	| { readonly kind: "not-open" };

type FuzzyRejectOutcome =
	| { readonly candidateId: number; readonly kind: "rejected" }
	| { readonly kind: "missing" }
	| { readonly kind: "not-open" };

const takeFirst = <Row>(rows: readonly Row[]): Row | undefined => rows[0];

// Stable order over service refs — by service, then id — so a proposed membership
// canonicalises the same however a producer happened to order it.
const byServiceRef = (first: ServiceRef, second: ServiceRef): number => {
	if (first.service !== second.service) {
		return first.service < second.service ? -1 : 1;
	}
	if (first.serviceId !== second.serviceId) {
		return first.serviceId < second.serviceId ? -1 : 1;
	}
	return 0;
};

// Best score first; ties fall back to the ref order so buckets are deterministic.
const byScore = (first: ScoredHit, second: ScoredHit): number =>
	first.score === second.score
		? byServiceRef(first, second)
		: second.score - first.score;

const refKey = (ref: ServiceRef): string =>
	JSON.stringify([ref.service, ref.serviceId]);

type YearAgreement = "absent" | "agree" | "disagree";

const yearAgreement = (
	queryYear: number | undefined,
	hitYear: number | undefined,
): YearAgreement => {
	if (queryYear === undefined || hitYear === undefined) {
		return "absent";
	}
	return Math.abs(queryYear - hitYear) <= YEAR_TOLERANCE ? "agree" : "disagree";
};

// Normalised title similarity weighted with year agreement. An absent year drops
// the year term and leans on the title; otherwise the year contributes its full
// weight when the years agree and nothing when they disagree.
const scoreHit = (query: FuzzyQuery, result: FuzzySearchResult): number => {
	const similarity = titleSimilarity(query.title, result.title);
	const agreement = yearAgreement(query.year, result.year);
	if (agreement === "absent") {
		return similarity;
	}
	const yearScore = agreement === "agree" ? 1 : 0;
	return TITLE_WEIGHT * similarity + YEAR_WEIGHT * yearScore;
};

// One service's search, capped and scored against its own query.
const searchService = async (
	client: FuzzySearchClient,
	query: FuzzyQuery,
): Promise<readonly ScoredHit[]> => {
	const results = await client.search(query.title, query.year);
	return results.slice(0, RESULT_CAP).map((result) => ({
		score: scoreHit(query, result),
		service: query.service,
		serviceId: result.serviceId,
		title: result.title,
		year: result.year,
	}));
};

// Search every service once (concurrently) and keep the best score per ref. Hits
// already in the subject's group — the subject included — are dropped: they are
// members, not proposals.
const gatherHits = async (
	deps: FuzzyDiscoveryDeps,
	input: FuzzyDiscoveryInput,
	existing: ReadonlySet<string>,
): Promise<readonly ScoredHit[]> => {
	const searches = input.queries.flatMap((query) => {
		const client = deps.clients[query.service];
		return client === undefined ? [] : [searchService(client, query)];
	});
	const perService = await Promise.all(searches);
	const best = new Map<string, ScoredHit>();
	for (const hit of perService.flat()) {
		const key = refKey(hit);
		if (existing.has(key)) {
			continue;
		}
		const current = best.get(key);
		if (current === undefined || hit.score > current.score) {
			best.set(key, hit);
		}
	}
	return [...best.values()];
};

interface Buckets {
	readonly alsoConsidered: readonly ScoredHit[];
	readonly overCap: readonly ScoredHit[];
	readonly proposedMembers: readonly ScoredHit[];
}

// Split the scored hits three ways: the score drops those below the bar into "also
// considered", and among the rest the member cap splits proposed members from the
// overflow the admin still sees ("over the cap").
const bucketHits = (scored: readonly ScoredHit[]): Buckets => {
	const cleared = scored.filter((hit) => hit.score >= MEMBER_BAR).toSorted(byScore);
	return {
		alsoConsidered: scored.filter((hit) => hit.score < MEMBER_BAR).toSorted(byScore),
		overCap: cleared.slice(MEMBER_CAP),
		proposedMembers: cleared.slice(0, MEMBER_CAP),
	};
};

const toStoredHit = (hit: ScoredHit): StoredHit => ({
	score: hit.score,
	service: hit.service,
	serviceId: hit.serviceId,
	title: hit.title,
	year: toStoredYear(hit.year),
});

const toStoredQuery = (query: FuzzyQuery): StoredQuery => ({
	service: query.service,
	title: query.title,
	year: toStoredYear(query.year),
});

// The proposed membership as a canonical set of service/id pairs. It fingerprints
// the row alongside its kind and subject: the same proposal reproduces the same
// hash and coalesces (or finds its rejection), while adding or removing a member
// hashes differently and reopens the question.
const evidenceHashOf = (proposed: readonly ScoredHit[]): string => {
	const refs = proposed
		.map((hit) => ({ service: hit.service, serviceId: hit.serviceId }))
		.toSorted(byServiceRef);
	return `fuzzy-group:${JSON.stringify(refs)}`;
};

interface QueuePlan {
	readonly evidence: FuzzyGroupEvidence;
	readonly evidenceHash: string;
	readonly subject: CandidateSubject;
	readonly subjectKey: string;
}

// Queue the case, coalescing on the open partial unique index and refusing to
// re-raise a proposal an admin already rejected. A repeat or concurrent discovery
// of the same subject and proposal inserts nothing; a matching rejection queues
// nothing at all.
const queueCandidate = (db: GatewayDb, plan: QueuePlan): FuzzyDiscoveryOutcome =>
	db.transaction((tx): FuzzyDiscoveryOutcome => {
		const rejected = tx
			.select({ id: pendingGroupCandidates.id })
			.from(pendingGroupCandidates)
			.where(
				and(
					eq(pendingGroupCandidates.kind, "fuzzy-group"),
					eq(pendingGroupCandidates.subjectKey, plan.subjectKey),
					eq(pendingGroupCandidates.evidenceHash, plan.evidenceHash),
					eq(pendingGroupCandidates.status, "rejected"),
				),
			)
			.all();
		if (rejected.length > 0) {
			return { evidence: plan.evidence, kind: "suppressed" };
		}
		const inserted = takeFirst(
			tx
				.insert(pendingGroupCandidates)
				.values({
					evidence: plan.evidence,
					evidenceHash: plan.evidenceHash,
					kind: "fuzzy-group",
					subject: plan.subject,
					subjectKey: plan.subjectKey,
				})
				.onConflictDoNothing()
				.returning()
				.all(),
		);
		return { candidateId: inserted?.id, evidence: plan.evidence, kind: "queued" };
	});

// The service/id pairs already in the subject's group — the subject among them —
// so a search hit that is already a member is never re-proposed.
const existingMembers = (db: GatewayDb, groupId: number): ReadonlySet<string> =>
	new Set(
		db
			.select({ service: serviceTitles.service, serviceId: serviceTitles.serviceId })
			.from(serviceTitles)
			.where(eq(serviceTitles.groupId, groupId))
			.all()
			.map((row) => refKey(row)),
	);

// The background closure. Search both services by the subject's title and year,
// bucket the hits, and queue a `fuzzy-group` candidate for whatever clears the
// bar. It writes only that candidate row — never membership — so a caller can
// chain it after persisting without the response or the write waiting on it.
const runFuzzyDiscovery = async (
	db: GatewayDb,
	deps: FuzzyDiscoveryDeps,
	input: FuzzyDiscoveryInput,
): Promise<FuzzyDiscoveryOutcome> => {
	const subjectTitle = takeFirst(
		db.select().from(serviceTitles).where(eq(serviceTitles.id, input.subjectTitleId)).all(),
	);
	if (subjectTitle === undefined) {
		return { kind: "no-subject" };
	}
	const groupId = survivorGroupId(db, subjectTitle.groupId);
	const scored = await gatherHits(deps, input, existingMembers(db, groupId));
	const buckets = bucketHits(scored);
	if (buckets.proposedMembers.length === 0) {
		return { kind: "no-proposal" };
	}
	const subject: CandidateSubject = {
		subjectType: "title",
		titleId: input.subjectTitleId,
	};
	return queueCandidate(db, {
		evidence: {
			alsoConsidered: buckets.alsoConsidered.map(toStoredHit),
			kind: "fuzzy-group",
			overCap: buckets.overCap.map(toStoredHit),
			proposedMembers: buckets.proposedMembers.map(toStoredHit),
			queries: input.queries.map(toStoredQuery),
		},
		evidenceHash: evidenceHashOf(buckets.proposedMembers),
		subject,
		subjectKey: candidateSubjectKey(subject),
	});
};

type FuzzyCandidateRow = typeof pendingGroupCandidates.$inferSelect;

const loadFuzzyCandidate = (
	db: GatewayDb,
	candidateId: number,
): FuzzyCandidateRow | undefined => {
	const row = takeFirst(
		db.select().from(pendingGroupCandidates).where(eq(pendingGroupCandidates.id, candidateId)).all(),
	);
	return row === undefined || row.kind !== "fuzzy-group" ? undefined : row;
};

interface AcceptPlan {
	readonly candidateId: number;
	readonly groupId: number;
	readonly refused: readonly ServiceRef[];
	readonly toAttach: readonly ServiceRef[];
}

// Re-rank the group densely — stored members keep the first positions in stored
// order, then the proposal follows in scored order — and return the ids attached.
const attachProposal = (
	tx: GatewayDb,
	groupId: number,
	toAttach: readonly ServiceRef[],
): readonly number[] => {
	const members = tx
		.select({ id: serviceTitles.id })
		.from(serviceTitles)
		.where(eq(serviceTitles.groupId, groupId))
		.orderBy(serviceTitles.ordinal, serviceTitles.id)
		.all();
	let ordinal = 0;
	for (const member of members) {
		tx.update(serviceTitles).set({ ordinal }).where(eq(serviceTitles.id, member.id)).run();
		ordinal += 1;
	}
	const attachedTitleIds: number[] = [];
	for (const ref of toAttach) {
		const created = takeFirst(
			tx
				.insert(serviceTitles)
				.values({ groupId, ordinal, service: ref.service, serviceId: ref.serviceId })
				.returning()
				.all(),
		);
		if (created === undefined) {
			throw new Error("service title insert returned no row");
		}
		attachedTitleIds.push(created.id);
		ordinal += 1;
	}
	return attachedTitleIds;
};

// Attach the proposal to the subject's group through the curated path. The accept
// is a human vouch, so the group turns curated and a later recompute preserves
// this membership.
const commitAccept = (db: GatewayDb, plan: AcceptPlan): FuzzyAcceptOutcome =>
	db.transaction((tx): FuzzyAcceptOutcome => {
		const current = loadFuzzyCandidate(tx, plan.candidateId);
		if (current === undefined) {
			return { kind: "missing" };
		}
		if (current.status !== "open") {
			return { kind: "not-open" };
		}
		const attachedTitleIds = attachProposal(tx, plan.groupId, plan.toAttach);
		tx.update(titleGroups).set({ source: "manual" }).where(eq(titleGroups.id, plan.groupId)).run();
		tx
			.update(pendingGroupCandidates)
			.set({ status: "accepted" })
			.where(eq(pendingGroupCandidates.id, plan.candidateId))
			.run();
		return { attachedTitleIds, groupId: plan.groupId, kind: "accepted", refused: plan.refused };
	});

// Accept a queued proposal through the curated attach path. A proposed title with
// no stored record is attached to the subject's group; one already stored under
// another group is refused rather than moved; one already in the subject's group
// is a no-op.
const acceptFuzzyCandidate = (db: GatewayDb, candidateId: number): FuzzyAcceptOutcome => {
	const candidate = loadFuzzyCandidate(db, candidateId);
	if (candidate === undefined) {
		return { kind: "missing" };
	}
	if (candidate.status !== "open") {
		return { kind: "not-open" };
	}
	const { evidence, subject } = candidate;
	if (evidence.kind !== "fuzzy-group" || subject.subjectType !== "title") {
		return { kind: "missing" };
	}
	const subjectTitle = takeFirst(
		db.select().from(serviceTitles).where(eq(serviceTitles.id, subject.titleId)).all(),
	);
	if (subjectTitle === undefined) {
		return { kind: "no-subject" };
	}
	const groupId = survivorGroupId(db, subjectTitle.groupId);
	const refused: ServiceRef[] = [];
	const toAttach: ServiceRef[] = [];
	for (const member of evidence.proposedMembers) {
		const ref: ServiceRef = { service: member.service, serviceId: member.serviceId };
		const match = and(
			eq(serviceTitles.service, ref.service),
			eq(serviceTitles.serviceId, ref.serviceId),
		);
		const stored = takeFirst(db.select().from(serviceTitles).where(match).all());
		if (stored === undefined) {
			toAttach.push(ref);
		} else if (survivorGroupId(db, stored.groupId) !== groupId) {
			refused.push(ref);
		}
	}
	return commitAccept(db, { candidateId, groupId, refused, toAttach });
};

// Record a rejection. Its `evidence_hash` (the proposed membership) is already on
// the row, so a later discovery of the same proposal finds it and queues nothing;
// a proposal that adds or removes a member hashes differently and reopens.
const rejectFuzzyCandidate = (db: GatewayDb, candidateId: number): FuzzyRejectOutcome =>
	db.transaction((tx): FuzzyRejectOutcome => {
		const candidate = loadFuzzyCandidate(tx, candidateId);
		if (candidate === undefined) {
			return { kind: "missing" };
		}
		if (candidate.status !== "open") {
			return { kind: "not-open" };
		}
		tx
			.update(pendingGroupCandidates)
			.set({ status: "rejected" })
			.where(eq(pendingGroupCandidates.id, candidateId))
			.run();
		return { candidateId, kind: "rejected" };
	});

export {
	acceptFuzzyCandidate,
	rejectFuzzyCandidate,
	runFuzzyDiscovery,
	scoreHit,
};
export type {
	FuzzyAcceptOutcome,
	FuzzyDiscoveryDeps,
	FuzzyDiscoveryInput,
	FuzzyDiscoveryOutcome,
	FuzzyQuery,
	FuzzyRejectOutcome,
	FuzzySearchClient,
	FuzzySearchClients,
	FuzzySearchResult,
};
