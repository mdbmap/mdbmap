import { describe, expect, it } from "vitest";

import type { Identity } from "@/engine/identity.ts";

import { createOverflowColdLookup, createWorkflowDispatcher } from "./cold.ts";
import type { BuildDispatcher, ColdEstimate, DispatchHandle } from "./cold.ts";
import { overflowInstanceId } from "./work.ts";
import type { BuildPayload, BuildWork } from "./work.ts";

const identity: Identity = {
	kind: "title",
	title: { id: "1", service: "mal" },
};

const workFor = (targetService: BuildWork["targetService"]): BuildWork => ({
	baselineRevision: 1,
	continuity: "simkl:anime:42",
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

		const result = await cold.begin(identity, "anime");

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

		await cold.begin(identity, "anime");

		expect(created.size).toBe(1);
	});

	it("leaves work that fits the synchronous budget as a miss", async () => {
		const { created, dispatcher } = recordingDispatcher();
		const cold = createOverflowColdLookup({
			dispatcher,
			estimate: () => ({ builds: [workFor("mal")], input: withinBudget }),
		});

		expect(await cold.begin(identity, "anime")).toEqual({ kind: "miss" });
		expect(created.size).toBe(0);
	});

	it("falls through when the id is not brokerable overflow work", async () => {
		const { dispatcher } = recordingDispatcher();
		const missing = new Map<string, ColdEstimate>();
		const cold = createOverflowColdLookup({
			dispatcher,
			estimate: () => missing.get("none"),
		});

		expect(await cold.begin(identity, "anime")).toEqual({ kind: "miss" });
	});

	it("dedupes two concurrent requests for the same work onto one instance", async () => {
		const { created, dispatcher, joins } = recordingDispatcher();
		const cold = createOverflowColdLookup({
			dispatcher,
			estimate: () => ({ builds: [workFor("mal")], input: overBudget }),
		});

		await cold.begin(identity, "anime");
		await cold.begin(identity, "anime");

		expect(created.size).toBe(1);
		expect(joins()).toBe(1);
	});
});

describe("createWorkflowDispatcher", () => {
	it("joins the running instance when its deterministic id already exists", async () => {
		const seen = new Set<string>();
		let getCalls = 0;
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
				getCalls += 1;
			},
		};
		const dispatcher = createWorkflowDispatcher(handle);
		const payload: BuildPayload = { work: workFor("mal") };

		await dispatcher.ensure("overflow_abc", payload);
		await dispatcher.ensure("overflow_abc", payload);

		expect(seen.size).toBe(1);
		expect(getCalls).toBe(1);
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

		await expect(
			dispatcher.ensure("overflow_abc", { work: workFor("mal") }),
		).rejects.toThrow("boom");
	});
});
