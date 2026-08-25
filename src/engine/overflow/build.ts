import type { Promisable } from "type-fest";

import type { Service } from "@/engine/identity.ts";

import type { BuildWork } from "./work.ts";

// Duration and backoff literals that satisfy the Cloudflare Workflows step config
// without importing the runtime here, so the orchestration stays unit-testable
// with a mocked step.
type DurationUnit =
	| "day"
	| "hour"
	| "minute"
	| "month"
	| "second"
	| "week"
	| "year";
type Duration = `${number} ${DurationUnit}${"" | "s"}`;
type Backoff = "constant" | "exponential" | "linear";

interface RetryPolicy {
	readonly backoff: Backoff;
	readonly delay: Duration;
	readonly limit: number;
}

// One durable step's retry and timeout policy. Steps are service-specific
// (ADR-0002 §overflow): a flaky upstream fetch retries differently from the
// atomic publish.
interface StepPolicy {
	readonly retries: RetryPolicy;
	readonly timeout: Duration;
}

interface BuildStepPolicies {
	readonly align: StepPolicy;
	readonly discover: StepPolicy;
	readonly fetchTarget: StepPolicy;
	readonly publish: StepPolicy;
}

// The slice of Cloudflare's `WorkflowStep` the orchestration uses. A test passes a
// step that just runs each callback; production passes the real durable step. The
// serializable bound is the runtime's own: a step's output is persisted for
// replay, so it must be structured-cloneable.
interface DurableStep {
	readonly do: <Result extends Rpc.Serializable<Result>>(
		name: string,
		policy: StepPolicy,
		run: () => Promise<Result>,
	) => Promise<Result>;
}

// The four durable phases, injected so steps call the discovery and matcher
// modules in production and simple stand-ins in tests. `publish` performs the
// atomic per-service coverage write.
interface BuildDeps<Chain, Streams, Alignment> {
	readonly align: (input: {
		readonly chain: Chain;
		readonly streams: Streams;
	}) => Promisable<Alignment>;
	readonly discover: () => Promisable<Chain>;
	readonly fetchTarget: (chain: Chain) => Promisable<Streams>;
	readonly publish: (alignment: Alignment) => Promisable<void>;
}

interface BuildOutcome {
	readonly published: boolean;
	readonly targetService: Service;
}

const defaultStepPolicies: BuildStepPolicies = {
	align: {
		retries: { backoff: "constant", delay: "2 seconds", limit: 2 },
		timeout: "30 seconds",
	},
	discover: {
		retries: { backoff: "exponential", delay: "5 seconds", limit: 3 },
		timeout: "30 seconds",
	},
	fetchTarget: {
		retries: { backoff: "exponential", delay: "10 seconds", limit: 5 },
		timeout: "1 minute",
	},
	publish: {
		retries: { backoff: "exponential", delay: "5 seconds", limit: 5 },
		timeout: "30 seconds",
	},
};

// One idempotent background build for one (continuity, target service, revision).
// Discovery, target fetching, alignment and publication are separate durable
// steps: a step already completed on a prior attempt is memoised and skipped, so
// a retry after a partial run resumes rather than repeats, and a publish that
// already committed is never undone (ADR-0002 §overflow).
const runOverflowBuild = async <
	Chain extends Rpc.Serializable<Chain>,
	Streams extends Rpc.Serializable<Streams>,
	Alignment extends Rpc.Serializable<Alignment>,
>(
	work: BuildWork,
	deps: BuildDeps<Chain, Streams, Alignment>,
	step: DurableStep,
	policies: BuildStepPolicies = defaultStepPolicies,
): Promise<BuildOutcome> => {
	const chain = await step.do("discover", policies.discover, async () =>
		deps.discover(),
	);
	const streams = await step.do(
		"fetch-target",
		policies.fetchTarget,
		async () => deps.fetchTarget(chain),
	);
	const alignment = await step.do("align", policies.align, async () =>
		deps.align({ chain, streams }),
	);
	await step.do("publish", policies.publish, async () => {
		await deps.publish(alignment);
		return { published: true };
	});
	return { published: true, targetService: work.targetService };
};

export { defaultStepPolicies, runOverflowBuild };
export type {
	BuildDeps,
	BuildOutcome,
	BuildStepPolicies,
	DurableStep,
	StepPolicy,
};
