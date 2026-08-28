import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { readCatalogueSecretsSource } from "@/engine/ingest/catalogue-secrets.ts";
import { createIngestEnvFromSource } from "@/engine/ingest/env.ts";

import { runOverflowBuild } from "./build.ts";
import type { DurableStep } from "./build.ts";
import { createBuildDeps } from "./deps.ts";
import type { BuildPayload } from "./work.ts";

// The thin Workflows runtime binding (ADR-0002 §overflow). All decision logic —
// the estimate, the deterministic instance id, the step orchestration and the
// atomic per-service publication — lives in the unit-tested modules; this class
// only adapts the durable step and hands off.

const toDurableStep = (step: WorkflowStep): DurableStep => ({
	do: async (name, policy, run) => step.do(name, policy, run),
});

const resolveBuildDeps = (env: Env, payload: BuildPayload) => {
	const ingest = createIngestEnvFromSource(
		env,
		readCatalogueSecretsSource(env),
	);
	if (ingest.structuralDiscovery === undefined) {
		throw new NonRetryableError(
			`overflow build deps: structural discovery clients not configured for target ${payload.work.targetService}`,
		);
	}
	return createBuildDeps(ingest, payload);
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
