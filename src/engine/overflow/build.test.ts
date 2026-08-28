import { describe, expect, it } from "vitest";

import { freshDb } from "@/db/test-helpers";
import type { Service } from "@/engine/identity.ts";

import { defaultStepPolicies, runOverflowBuild } from "./build.ts";
import type { BuildDeps, DurableStep, StepPolicy } from "./build.ts";
import {
	completeCoverage,
	coverageStatesFor,
	groupCoverageKey,
	seedPendingCoverage,
} from "./coverage.ts";
import type { BuildWork } from "./work.ts";

interface StepCall {
	readonly name: string;
	readonly policy: StepPolicy;
}

const recordingStep = (): {
	readonly calls: StepCall[];
	readonly step: DurableStep;
} => {
	const calls: StepCall[] = [];
	return {
		calls,
		step: {
			do: async (name, policy, run) => {
				calls.push({ name, policy });
				return run();
			},
		},
	};
};

const workFor = (targetService: Service): BuildWork => ({
	baselineRevision: 1,
	continuity: groupCoverageKey(42),
	targetService,
});

describe("runOverflowBuild", () => {
	it("seeds, discovers, fetches, aligns and publishes as ordered durable steps", async () => {
		const received: string[] = [];
		const deps: BuildDeps<string, string, string> = {
			align: ({ chain, streams }) => {
				received.push(`align:${chain}:${streams}`);
				return "aligned";
			},
			discover: () => "chain",
			fetchTarget: (chain) => {
				received.push(`fetch:${chain}`);
				return "streams";
			},
			publish: (alignment) => {
				received.push(`publish:${alignment}`);
			},
			seedPending: () => {
				received.push("seed");
			},
		};
		const { calls, step } = recordingStep();

		const outcome = await runOverflowBuild(workFor("mal"), deps, step);

		expect(outcome).toEqual({ targetService: "mal" });
		expect(calls.map((call) => call.name)).toEqual([
			"seed",
			"discover",
			"fetch-target",
			"align",
			"publish",
		]);
		// Seeding runs before any fetch, so a reader sees pending, never partial.
		expect(received).toEqual([
			"seed",
			"fetch:chain",
			"align:chain:streams",
			"publish:aligned",
		]);
		// Steps carry service-specific retry and timeout policies.
		expect(calls[2]?.policy).toBe(defaultStepPolicies.fetchTarget);
		expect(calls[2]?.policy.timeout).not.toBe(
			defaultStepPolicies.discover.timeout,
		);
	});

	it("publishes healthy services while an outage leaves its service pending", async () => {
		const db = await freshDb();
		const continuity = groupCoverageKey(42);
		const revision = 1;

		const healthyDeps = (
			service: Service,
		): BuildDeps<string, string, string> => ({
			align: () => "aligned",
			discover: () => "chain",
			fetchTarget: (chain) => chain,
			publish: async () => completeCoverage(db, continuity, revision, service),
			seedPending: async () =>
				seedPendingCoverage(db, continuity, revision, service),
		});
		const kitsuDeps: BuildDeps<string, string, string> = {
			align: () => "aligned",
			discover: () => "chain",
			fetchTarget: () => {
				throw new Error("kitsu upstream unavailable");
			},
			publish: async () => completeCoverage(db, continuity, revision, "kitsu"),
			seedPending: async () =>
				seedPendingCoverage(db, continuity, revision, "kitsu"),
		};

		await runOverflowBuild(
			workFor("anilist"),
			healthyDeps("anilist"),
			recordingStep().step,
		);
		await runOverflowBuild(
			workFor("mal"),
			healthyDeps("mal"),
			recordingStep().step,
		);
		await expect(
			runOverflowBuild(workFor("kitsu"), kitsuDeps, recordingStep().step),
		).rejects.toThrow("kitsu upstream unavailable");

		const states = await coverageStatesFor(db, continuity, revision);
		expect(states.get("anilist")).toBe("complete");
		expect(states.get("mal")).toBe("complete");
		expect(states.get("kitsu")).toBe("pending");
	});
});
