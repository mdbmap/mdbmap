import type { SimklClient, SimklEntry, SimklService } from "./simkl.ts";
import { simklServices } from "./simkl.ts";
import type {
	ContinuityChain,
	ContinuityConflict,
	WalkResult,
} from "./walk.ts";
import { walkContinuity } from "./walk.ts";

// The discovery broker (ADR-0002). On a cache miss it tries SIMKL first for any
// id SIMKL brokers, walks the continuity and fans out the chain's external ids
// to the requested target. SIMKL is a shortcut, never a dependency: a missing
// client, missing record or failed request falls through to direct discovery
// and never rebases the request.

interface RequestCursor {
	id: string;
	service: string;
}

interface DiscoveryRequest {
	cursor: RequestCursor;
	target: string;
}

type FallthroughReason =
	| "no-record"
	| "request-failed"
	| "unconfigured"
	| "unsupported-id";

interface DirectDiscovery {
	cursor: RequestCursor;
	kind: "fallthrough";
	reason: FallthroughReason;
	target: string;
}

interface BrokeredChain {
	// Target-service candidate ids along the chain, in order — checked before any
	// title search. They stay candidates the target must verify (ADR-0002).
	candidates: readonly string[];
	chain: ContinuityChain;
	cursor: RequestCursor;
	kind: "brokered";
}

type BrokerOutcome = BrokeredChain | ContinuityConflict | DirectDiscovery;

interface BrokerDeps {
	simkl?: SimklClient;
}

const isSimklService = (value: string): value is SimklService =>
	(simklServices as readonly string[]).includes(value);

const fallthrough = (
	request: DiscoveryRequest,
	reason: FallthroughReason,
): DirectDiscovery => ({
	cursor: request.cursor,
	kind: "fallthrough",
	reason,
	target: request.target,
});

const candidatesFor = (chain: ContinuityChain, target: string): string[] => {
	if (!isSimklService(target)) {
		return [];
	}
	const seen = new Set<string>();
	for (const segment of chain.segments) {
		const candidate = segment.externalIds[target];
		if (candidate !== undefined) {
			seen.add(candidate);
		}
	}
	return [...seen];
};

const discover = async (
	request: DiscoveryRequest,
	deps: BrokerDeps,
): Promise<BrokerOutcome> => {
	const { cursor, target } = request;
	const { simkl } = deps;
	if (simkl === undefined) {
		return fallthrough(request, "unconfigured");
	}
	if (!isSimklService(cursor.service)) {
		return fallthrough(request, "unsupported-id");
	}

	let start: SimklEntry | undefined;
	try {
		start = await simkl.findByExternalId(cursor.service, cursor.id);
	} catch {
		return fallthrough(request, "request-failed");
	}
	if (start === undefined) {
		return fallthrough(request, "no-record");
	}

	// A search hit carries no relations (searchSchema); the anime record is
	// re-fetched in full so the walk expands the real continuity instead of
	// collapsing to the searched entry. A non-anime hit is never walked — it
	// reaches the walk's guard as its own start and yields the
	// non-anime-candidate conflict without touching the anime endpoint.
	let entry = start;
	if (start.type === "anime") {
		let full: SimklEntry | undefined;
		try {
			full = await simkl.fetchEntry(start.id);
		} catch {
			return fallthrough(request, "request-failed");
		}
		if (full === undefined) {
			return fallthrough(request, "no-record");
		}
		entry = full;
	}

	let result: WalkResult;
	try {
		result = await walkContinuity(entry, { fetchEntry: simkl.fetchEntry });
	} catch {
		return fallthrough(request, "request-failed");
	}
	if (result.kind === "continuity-conflict") {
		return result;
	}

	return {
		candidates: candidatesFor(result, target),
		chain: result,
		cursor,
		kind: "brokered",
	};
};

export { discover };
export type {
	BrokeredChain,
	BrokerDeps,
	BrokerOutcome,
	DirectDiscovery,
	DiscoveryRequest,
	FallthroughReason,
	RequestCursor,
};
