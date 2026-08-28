import { afterEach, describe, expect, it, vi } from "vitest";

import { freshDb } from "@/db/test-helpers";
import type {
	DiscoveryClients,
	EnumeratedTitle,
	ServiceRef,
} from "@/engine/discovery/structural.ts";
import { bootstrapFromIdentity } from "@/engine/ingest/bootstrap.ts";
import type { InstalmentFacts } from "@/engine/matcher";
import { locator, regular, streamOf } from "@/engine/matcher/test-fixtures.ts";
import {
	coverageStateFor,
	groupCoverageKey,
} from "@/engine/overflow/coverage.ts";

import { runOverflowBuild } from "./build.ts";
import type { DurableStep } from "./build.ts";
import { createBuildDeps } from "./deps.ts";
import type { BuildPayload } from "./work.ts";

afterEach(() => {
	vi.restoreAllMocks();
});

const knownMal = { id: "50265", service: "mal" as const };
const knownIdentity = { kind: "title" as const, title: knownMal };

const ref = (service: string, serviceId: string): ServiceRef => ({
	service,
	serviceId,
});

const factsOf = (
	entries: readonly (readonly [string, InstalmentFacts])[],
): ReadonlyMap<ReturnType<typeof locator>, InstalmentFacts> => {
	const map = new Map<ReturnType<typeof locator>, InstalmentFacts>();
	for (const [raw, fact] of entries) {
		map.set(locator(raw), fact);
	}
	return map;
};

const malTitle: EnumeratedTitle = {
	facts: factsOf([
		["s1e1", { airDate: "2022-04-09", title: "Operation Strix" }],
	]),
	stream: streamOf([regular("s1e1")]),
};

const anilistTitle: EnumeratedTitle = {
	facts: factsOf([
		["s1e1", { airDate: "2022-04-09", title: "Operation Strix" }],
	]),
	stream: streamOf([regular("s1e1")]),
};

const publishClients = (): DiscoveryClients => ({
	externalIds: {
		describe: (title) => {
			if (title.service === "mal" && title.serviceId === knownMal.id) {
				return {
					externalIds: [ref("anilist", "140960")],
					firstAirDate: "2022-04-09",
				};
			}
			if (title.service === "anilist" && title.serviceId === "140960") {
				return {
					externalIds: [ref("mal", knownMal.id)],
					firstAirDate: "2022-04-09",
				};
			}
			return { externalIds: [], firstAirDate: undefined };
		},
	},
	find: {
		find: () => [ref("anilist", "140960")],
	},
	instalments: {
		enumerate: (title) => {
			if (title.service === "mal") {
				return malTitle;
			}
			if (title.service === "anilist") {
				return anilistTitle;
			}
			return { facts: factsOf([]), stream: streamOf([]) };
		},
	},
});

const recordingStep: DurableStep = {
	do: async (_name, _policy, run) => run(),
};

const expectOverflowPending = async (
	work: BuildPayload["work"],
	deps: ReturnType<typeof createBuildDeps>,
): Promise<void> => {
	const build = runOverflowBuild(work, deps, recordingStep);
	await expect(build).rejects.toThrow("coverage pending");
};

describe("createBuildDeps", () => {
	it("runs all five durable steps and marks coverage complete for one target", async () => {
		const db = await freshDb();
		const bootstrapped = await bootstrapFromIdentity(db, knownIdentity);
		if (bootstrapped.kind !== "bootstrapped") {
			throw new Error(`expected bootstrapped, got ${bootstrapped.kind}`);
		}

		const payload: BuildPayload = {
			identity: knownIdentity,
			profile: "anime",
			work: {
				baselineRevision: 1,
				continuity: groupCoverageKey(bootstrapped.group.groupId),
				targetService: "anilist",
			},
		};
		const deps = createBuildDeps(
			{
				catalogue: { simkl: undefined, verification: {} },
				db,
				dispatcher: undefined,
				structuralDiscovery: publishClients(),
			},
			payload,
		);

		const outcome = await runOverflowBuild(payload.work, deps, recordingStep);

		expect(outcome).toEqual({ targetService: "anilist" });
		const coverage = await coverageStateFor(
			db,
			groupCoverageKey(bootstrapped.group.groupId),
			1,
			"anilist",
		);
		expect(coverage).toBe("complete");
	});
});

describe("createBuildDeps review regressions", () => {
	it("falls back to direct discovery when structural discovery override is absent", async () => {
		const structuralModule =
			await import("@/engine/ingest/structural-discovery.ts");
		vi.spyOn(
			structuralModule,
			"buildStructuralDiscoveryClients",
		).mockReturnValue(publishClients());
		const db = await freshDb();
		const bootstrapped = await bootstrapFromIdentity(db, knownIdentity);
		if (bootstrapped.kind !== "bootstrapped") {
			throw new Error(`expected bootstrapped, got ${bootstrapped.kind}`);
		}
		const payload: BuildPayload = {
			identity: knownIdentity,
			profile: "anime",
			work: {
				baselineRevision: 1,
				continuity: groupCoverageKey(bootstrapped.group.groupId),
				targetService: "anilist",
			},
		};
		const deps = createBuildDeps(
			{
				catalogue: { simkl: undefined, verification: {} },
				db,
				dispatcher: undefined,
				structuralDiscovery: undefined,
			},
			payload,
		);
		const outcome = await runOverflowBuild(payload.work, deps, recordingStep);

		expect(outcome).toEqual({ targetService: "anilist" });
		const coverage = await coverageStateFor(
			db,
			groupCoverageKey(bootstrapped.group.groupId),
			1,
			"anilist",
		);
		expect(coverage).toBe("complete");
	});

	it("leaves coverage pending when discovery is refused", async () => {
		const phasesModule = await import("@/engine/ingest/phases.ts");
		vi.spyOn(phasesModule, "discoverGroup").mockResolvedValueOnce({
			kind: "refused",
			reason: "over-budget",
		});
		const db = await freshDb();
		const bootstrapped = await bootstrapFromIdentity(db, knownIdentity);
		if (bootstrapped.kind !== "bootstrapped") {
			throw new Error(`expected bootstrapped, got ${bootstrapped.kind}`);
		}
		const payload: BuildPayload = {
			identity: knownIdentity,
			profile: "anime",
			work: {
				baselineRevision: 1,
				continuity: groupCoverageKey(bootstrapped.group.groupId),
				targetService: "anilist",
			},
		};
		const deps = createBuildDeps(
			{
				catalogue: { simkl: undefined, verification: {} },
				db,
				dispatcher: undefined,
				structuralDiscovery: publishClients(),
			},
			payload,
		);

		await expectOverflowPending(payload.work, deps);

		const coverage = await coverageStateFor(
			db,
			groupCoverageKey(bootstrapped.group.groupId),
			1,
			"anilist",
		);
		expect(coverage).toBe("pending");
	});
});
