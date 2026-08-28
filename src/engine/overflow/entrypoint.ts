import { WorkflowEntrypoint } from "cloudflare:workers";
import type { WorkflowEvent, WorkflowStep } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";

import { readCatalogueSecretsSource } from "@/engine/ingest/catalogue-secrets.ts";
import { createIngestEnvFromSource } from "@/engine/ingest/env.ts";

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
// and D1 publication uses the shared ingest env factory for D1 and catalogue
// clients. Phase implementations that map BuildWork to BuildDeps are tracked in
// the live-ingest epic; until they land, an overflow instance fails fast rather
// than retrying unimplemented work.
const resolveBuildDeps = (
	env: Env,
	payload: BuildPayload,
): BuildDeps<never, never, never> => {
	const ingest = createIngestEnvFromSource(
		env,
		readCatalogueSecretsSource(env),
	);
	throw new NonRetryableError(
		`overflow build deps not wired for target ${payload.work.targetService} ` +
			`(simkl=${ingest.catalogue.simkl === undefined ? "off" : "on"}, ` +
			`bindings: ${Object.keys(env).toSorted().join(", ")}); pending shared ingest phases`,
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
