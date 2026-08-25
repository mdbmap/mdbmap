import type { ContinuityKey } from "@/db/schema.ts";
import type { Service } from "@/engine/identity.ts";

// The atomic unit of overflow work (ADR-0002 §overflow): one target-service
// comparison of one baseline continuity at one revision. A build owns exactly
// one of these, and its identity is the dedup key concurrent requests share.
interface BuildWork {
	readonly baselineRevision: number;
	readonly continuity: ContinuityKey;
	readonly targetService: Service;
}

// What a Workflow instance is triggered with. Serializable by construction so it
// survives the durable-execution boundary.
interface BuildPayload {
	readonly work: BuildWork;
}

// A NUL joins the tuple so no field's contents can spill into the next and forge
// a different work's key.
const FIELD_SEPARATOR = "\u0000";

// Hex keeps the id inside the instance-id charset whatever a continuity key
// contains, and stays injective so distinct work never shares a build.
const toHex = (value: string): string =>
	[...new TextEncoder().encode(value)]
		.map((byte) => byte.toString(16).padStart(2, "0"))
		.join("");

// Deterministic instance id (ADR-0002 §overflow): two concurrent requests for
// the same work derive the same id, so the second joins the first's build
// instead of forking a duplicate, and a retry after a crash reclaims it.
const overflowInstanceId = (work: BuildWork): string => {
	const canonical = [
		work.continuity,
		work.targetService,
		work.baselineRevision.toString(),
	].join(FIELD_SEPARATOR);
	return `overflow_${toHex(canonical)}`;
};

export { overflowInstanceId };
export type { BuildPayload, BuildWork };
