import { describe, expect, it } from "vitest";

import type { Identity } from "@/engine/identity.ts";

import { createOverflowColdLookup, createWorkflowDispatcher } from "./cold.ts";
import type { BuildDispatcher, ColdEstimate, DispatchHandle } from "./cold.ts";
import { groupCoverageKey } from "./coverage.ts";
import { overflowInstanceId } from "./work.ts";
import type { BuildPayload, BuildWork } from "./work.ts";

const identity: Identity = {
	kind: "title",
	title: { id: "1", service: "mal" },
};

const profile = "anime" as const;

const payloadFor = (work: BuildWork): BuildPayload => ({
	identity,
	profile,
	work,
});

const workFor = (targetService: BuildWork["targetService"]): BuildWork => ({
	baselineRevision: 1,
	continuity: groupCoverageKey(42),
	targetService,
});

const overBudget = {
	chainSegments: 40,
	targetCandidates: 6,
	targetServices: 3,
};
const withinBudget = {
	chainSegments: 1,
	targetCandidates: 1,
	targetServices: 1,
};

const recordingDispatcher = (): {
	readonly created: ReadonlySet<string>;
	readonly dispatcher: BuildDispatcher;
	readonly joins: () => number;
} => {
	const created = new Set<string>();
	let joins = 0;
	return {
		created,
		dispatcher: {
			ensure: async (instanceId) => {
				await Promise.resolve();
				if (created.has(instanceId)) {
					joins += 1;
					return;
				}
				created.add(instanceId);
			},
		},
		joins: () => joins,
	};
};

describe("createOverflowColdLookup", () => {
	it("starts one build per fan-out target and points the status at the requested one", async () => {
		const { created, dispatcher } = recordingDispatcher();
		const estimate: ColdEstimate = {
			builds: [workFor("mal"), workFor("anilist"), workFor("kitsu")],
			input: overBudget,
		};
		const cold = createOverflowColdLookup({
			dispatcher,
			estimate: () => estimate,
		});

		const result = await cold.begin(identity, profile);

		expect(result.kind).toBe("started");
		if (result.kind === "started") {
			expect(result.build.retryAfterSeconds).toBe(5);
			expect(result.build.statusUrl).toContain(
				overflowInstanceId(workFor("mal")),
			);
		}
		expect(created.size).toBe(3);
	});

	it("starts exactly one build for an over-budget single target", async () => {
		const { created, dispatcher } = recordingDispatcher();
		const cold = createOverflowColdLookup({
			dispatcher,
			estimate: () => ({ builds: [workFor("mal")], input: overBudget }),
		});

		await cold.begin(identity, profile);

		expect(created.size).toBe(1);
	});

	it("leaves work that fits the synchronous budget as a miss", async () => {
		const { created, dispatcher } = recordingDispatcher();
		const cold = createOverflowColdLookup({
			dispatcher,
			estimate: () => ({ builds: [workFor("mal")], input: withinBudget }),
		});

		expect(await cold.begin(identity, profile)).toEqual({ kind: "miss" });
		expect(created.size).toBe(0);
	});

	it("falls through when the id is not brokerable overflow work", async () => {
		const { dispatcher } = recordingDispatcher();
		const missing = new Map<string, ColdEstimate>();
		const cold = createOverflowColdLookup({
			dispatcher,
			estimate: () => missing.get("none"),
		});

		expect(await cold.begin(identity, profile)).toEqual({ kind: "miss" });
	});

	it("dedupes two concurrent requests for the same work onto one instance", async () => {
		const { created, dispatcher, joins } = recordingDispatcher();
		const cold = createOverflowColdLookup({
			dispatcher,
			estimate: () => ({ builds: [workFor("mal")], input: overBudget }),
		});

		await cold.begin(identity, profile);
		await cold.begin(identity, profile);

		expect(created.size).toBe(1);
		expect(joins()).toBe(1);
	});
});

describe("createWorkflowDispatcher", () => {
	it("joins the running instance when its deterministic id already exists", async () => {
		const seen = new Set<string>();
		let statusCalls = 0;
		const handle: DispatchHandle = {
			create: async ({ id }) => {
				await Promise.resolve();
				if (seen.has(id)) {
					throw new Error("instance exists");
				}
				seen.add(id);
			},
			get: async () => {
				await Promise.resolve();
				return {
					restart: async () => {
						await Promise.resolve();
						throw new Error("unexpected restart");
					},
					status: async () => {
						await Promise.resolve();
						statusCalls += 1;
						return { status: "running" };
					},
				};
			},
		};
		const dispatcher = createWorkflowDispatcher(handle);
		const payload = payloadFor(workFor("mal"));

		await dispatcher.ensure("overflow_abc", payload);
		await dispatcher.ensure("overflow_abc", payload);

		expect(seen.size).toBe(1);
		expect(statusCalls).toBe(1);
	});

	it("restarts errored instances instead of joining them", async () => {
		let restarted = false;
		const handle: DispatchHandle = {
			create: async () => {
				await Promise.resolve();
				throw new Error("instance exists");
			},
			get: async () => {
				await Promise.resolve();
				return {
					restart: async () => {
						await Promise.resolve();
						restarted = true;
					},
					status: async () => {
						await Promise.resolve();
						return { status: "errored" };
					},
				};
			},
		};
		const dispatcher = createWorkflowDispatcher(handle);
		const payload = payloadFor(workFor("mal"));

		await dispatcher.ensure("overflow_abc", payload);

		expect(restarted).toBe(true);
	});

	it("rethrows a create failure that is not a duplicate", async () => {
		const handle: DispatchHandle = {
			create: async () => {
				await Promise.resolve();
				throw new Error("boom");
			},
			get: async () => {
				await Promise.resolve();
				throw new Error("no such instance");
			},
		};
		const dispatcher = createWorkflowDispatcher(handle);

		const payload = payloadFor(workFor("mal"));
		await expect(dispatcher.ensure("overflow_abc", payload)).rejects.toThrow(
			"boom",
		);
	});
});
