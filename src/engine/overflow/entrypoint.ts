import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { runOverflowBuild } from "./build.ts";
import type { BuildDeps, DurableStep } from "./build.ts";
import type { BuildPayload } from "./work.ts";

// The thin Workflows runtime binding (ADR-0002 §overflow). All decision logic —
// the estimate, the deterministic instance id, the step orchestration and the
// atomic per-service publication — lives in the unit-tested modules; this class
// only adapts the durable step and hands off.

const toDurableStep = (step: WorkflowStep): DurableStep => ({
	do: async (name, policy, run) => step.do(name, policy, run),
});

// Wiring the four durable phases to live discovery, target fetching, the matcher
// and D1 publication needs the provider clients and the D1 binding, neither of
// which the Worker environment carries yet (the app db is still better-sqlite3,
// and no target-service client provisioning is centralised). That integration is
// tracked separately; until it lands, an overflow instance fails fast rather
// than retrying unimplemented work.
const resolveBuildDeps = (
	env: Env,
	payload: BuildPayload,
): BuildDeps<never, never, never> => {
	// `env` will supply the D1 database and the target-service provider clients the
	// four phases draw on; neither is provisioned for the Worker yet.
	throw new NonRetryableError(
		`overflow build deps not wired for target ${payload.work.targetService} ` +
			`(bindings: ${Object.keys(env).toSorted().join(", ")}); pending provider-client and D1 integration`,
	);
};

class OverflowBuildWorkflow extends WorkflowEntrypoint<Env, BuildPayload> {
	public override async run(
		event: Readonly<WorkflowEvent<BuildPayload>>,
		step: WorkflowStep,
	): Promise<unknown> {
		return runOverflowBuild(
			event.payload.work,
			resolveBuildDeps(this.env, event.payload),
			toDurableStep(step),
		);
	}
}

export { OverflowBuildWorkflow };
