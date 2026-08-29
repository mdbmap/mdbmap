import type { Db as GatewayDb } from "@/db";
import { formatId, parseId } from "@/engine/identity.ts";
import type { Profile } from "@/engine/identity.ts";
import { serialize } from "@/engine/serializer.ts";
import type { MappingResponse } from "@/engine/serializer.ts";

import type { ColdLookup } from "./cold-lookup.ts";
import { readGraph } from "./read.ts";

// The default poll delay a warm pending build advertises. A cold build sets its
// own; this only covers the seeded-pending path where no build handle exists yet.
const WARM_RETRY_AFTER_SECONDS = 5;

// The engine's decision for one request, before it becomes an HTTP response.
type MappingOutcome =
	| {
			readonly body: MappingResponse;
			readonly kind: "conflict";
			readonly review: string;
	  }
	| { readonly body: MappingResponse; readonly kind: "ok" }
	| {
			readonly body: MappingResponse;
			readonly kind: "pending";
			readonly retryAfterSeconds: number;
			readonly statusUrl: string;
	  }
	| { readonly expected: string; readonly kind: "malformed" }
	| { readonly kind: "unknown" };

const statusUrlFor = (ref: string): string => `/api/engine/status/${ref}`;

const resolveMapping = async (
	db: GatewayDb,
	profile: Profile,
	rawId: string,
	coldLookup: ColdLookup,
): Promise<MappingOutcome> => {
	const parsed = parseId(profile, rawId);
	if (!parsed.ok) {
		return { expected: parsed.error.expected, kind: "malformed" };
	}
	let read = await readGraph(db, parsed.identity);
	if (!read.found) {
		const cold = await coldLookup.begin(parsed.identity, profile);
		read = await readGraph(db, parsed.identity);
		if (!read.found) {
			if (cold.kind !== "started") {
				return { kind: "unknown" };
			}
			return {
				body: { input: formatId(parsed.identity), mappings: {} },
				kind: "pending",
				retryAfterSeconds: cold.build.retryAfterSeconds,
				statusUrl: cold.build.statusUrl,
			};
		}
	}
	const statuses = [...read.answer.links.values()].map((link) => link.status);
	const usable =
		read.answer.links.size === 0 ||
		statuses.some(
			(status) => status === "matched" || status === "known-no-counterpart",
		);
	if (usable) {
		return {
			body:
				read.continuityId === undefined
					? serialize(read.answer)
					: serialize(read.answer, { continuityId: read.continuityId }),
			kind: "ok",
		};
	}
	if (statuses.includes("pending") && read.pendingRef !== undefined) {
		return {
			body: serialize(read.answer),
			kind: "pending",
			retryAfterSeconds: WARM_RETRY_AFTER_SECONDS,
			statusUrl: statusUrlFor(read.pendingRef),
		};
	}
	const body = serialize(read.answer);
	return read.reviewRef === undefined
		? { body, kind: "ok" }
		: { body, kind: "conflict", review: read.reviewRef };
};

export { resolveMapping };
export type { MappingOutcome };
