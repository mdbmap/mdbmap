import type { Promisable } from "type-fest";

import type { ColdLookup, ColdResult } from "@/engine/gateway/cold-lookup.ts";
import type { Identity, Profile } from "@/engine/identity.ts";

import { defaultOverflowBudget, estimateBuild } from "./estimate.ts";
import type { EstimateInput, OverflowBudget } from "./estimate.ts";
import { overflowInstanceId } from "./work.ts";
import type { BuildPayload, BuildWork } from "./work.ts";

// The cold-miss hand-off (ADR-0002 §overflow). A graph miss estimates the work;
// what fits the synchronous budget falls back to the inline compute path, and
// what does not starts — or joins — one idempotent background build per target
// service in the fan-out.

// Start a build if its instance id is new, otherwise join the running one. The
// deterministic id is what makes a concurrent request for the same work join.
interface BuildDispatcher {
	readonly ensure: (instanceId: string, payload: BuildPayload) => Promise<void>;
}

// The cheap discovery pre-scan a cold miss runs before any list fetch. It yields
// the fan-out's builds (the requested target first) and the counts the estimate
// sizes. `undefined` means the id is not brokerable overflow work — the miss
// falls through unchanged.
interface ColdEstimate {
	readonly builds: readonly BuildWork[];
	readonly input: EstimateInput;
}

interface OverflowColdDeps {
	readonly budget?: OverflowBudget;
	readonly dispatcher: BuildDispatcher;
	readonly estimate: (
		identity: Identity,
		profile: Profile,
	) => Promisable<ColdEstimate | undefined>;
	readonly retryAfterSeconds?: number;
}

const DEFAULT_RETRY_AFTER_SECONDS = 5;

const statusPathFor = (instanceId: string): string =>
	`/api/engine/status/${instanceId}`;

const createOverflowColdLookup = (deps: OverflowColdDeps): ColdLookup => {
	const budget = deps.budget ?? defaultOverflowBudget;
	const retryAfterSeconds =
		deps.retryAfterSeconds ?? DEFAULT_RETRY_AFTER_SECONDS;
	return {
		begin: async (identity, profile): Promise<ColdResult> => {
			const estimate = await deps.estimate(identity, profile);
			const [primary] = estimate?.builds ?? [];
			if (estimate === undefined || primary === undefined) {
				return { kind: "miss" };
			}
			if (estimateBuild(estimate.input, budget).fitsBudget) {
				return { kind: "miss" };
			}
			await Promise.all(
				estimate.builds.map(async (work) => {
					await deps.dispatcher.ensure(overflowInstanceId(work), { work });
				}),
			);
			return {
				build: {
					retryAfterSeconds,
					statusUrl: statusPathFor(overflowInstanceId(primary)),
				},
				kind: "started",
			};
		},
	};
};

// The production dispatcher over a Cloudflare Workflows binding. Structural over
// the binding so it stays testable: `env.OVERFLOW_BUILD` satisfies it.
interface DispatchHandle {
	readonly create: (options: {
		readonly id: string;
		readonly params: BuildPayload;
	}) => Promise<unknown>;
	readonly get: (instanceId: string) => Promise<unknown>;
}

const createWorkflowDispatcher = (
	workflow: DispatchHandle,
): BuildDispatcher => ({
	ensure: async (instanceId, payload) => {
		try {
			await workflow.create({ id: instanceId, params: payload });
		} catch (error) {
			// Creating an existing id throws: a concurrent request already started
			// this exact work, so joining its instance is success. A get that also
			// fails means the create error was real, not a duplicate — rethrow it.
			await workflow.get(instanceId).catch(() => {
				throw error;
			});
		}
	},
});

export { createOverflowColdLookup, createWorkflowDispatcher };
export type { BuildDispatcher, ColdEstimate, DispatchHandle, OverflowColdDeps };
