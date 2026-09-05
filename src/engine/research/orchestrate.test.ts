import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { one } from "@/db";
import {
	contentUnits,
	instalmentAssertions,
	pendingGroupCandidates,
	relationAssertions,
	serviceInstalments,
	serviceTitles,
	titleAssertions,
	titleGroups,
} from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import type {
	CatalogueTitle,
	SimklClient,
	SimklEntry,
} from "@/engine/discovery";
import { storeProvider } from "@/lib/provider-config";
import { randomMasterKey } from "@/lib/provider-config/test-support.ts";

import { isOfficialOperatorUrl } from "./domains.ts";
import { runResearchPass } from "./orchestrate.ts";
import type { ResearchAgent, ResearchContinuity } from "./orchestrate.ts";
import { createMemoryTimingStore, shouldRunResearch } from "./timing.ts";
import type { ResearchCatalogueClient, ResearchToolset } from "./tools.ts";

type TestDb = Awaited<ReturnType<typeof freshDb>>;

const seedGroup = async (db: TestDb) =>
	one(
		await db
			.insert(titleGroups)
			.values({ ladderComplete: false, source: "t1-structure" })
			.returning()
			.all(),
	);

const catalogue = (
	fields: Partial<CatalogueTitle> & {
		readonly instalments?: readonly {
			readonly kind?: "regular" | "special";
			readonly locator: string;
		}[];
		readonly title: string;
	},
): CatalogueTitle & {
	readonly instalments: readonly {
		readonly kind?: "regular" | "special";
		readonly locator: string;
	}[];
} => ({
	format: fields.format,
	instalmentCount: fields.instalmentCount,
	instalments: fields.instalments ?? [],
	releaseDate: fields.releaseDate,
	title: fields.title,
});

const clientFor = (
	records: Record<string, ReturnType<typeof catalogue>>,
): ResearchCatalogueClient => ({
	fetchCatalogue: (serviceId) => records[serviceId],
	fetchTitle: (serviceId) => {
		const record = records[serviceId];
		if (record === undefined) {
			return;
		}
		return {
			format: record.format,
			instalmentCount: record.instalmentCount,
			releaseDate: record.releaseDate,
			title: record.title,
		};
	},
});

const simklEntry = (overrides: Partial<SimklEntry> = {}): SimklEntry => ({
	externalIds: { anidb: "1", mal: "10", tmdb: "100" },
	id: "555",
	relations: [],
	title: "Hinted Show",
	type: "anime",
	...overrides,
});

const simklClient = (entry: SimklEntry): SimklClient => ({
	fetchEntry: async (id) => {
		await Promise.resolve();
		return id === entry.id ? entry : undefined;
	},
	findByExternalId: async () => {
		await Promise.resolve();
		return entry;
	},
});

const noopReview = async (): Promise<void> => {
	await Promise.resolve();
};

const requireAvailable = async (
	tools: ResearchToolset,
	service: string,
	serviceId: string,
) => {
	const fetched = await tools.fetchCatalogue(service, serviceId);
	if (fetched.unavailable) {
		throw new Error(`expected catalogue for ${service}:${serviceId}`);
	}
	return fetched;
};

const highTitleAgent: ResearchAgent = async ({ tools, provider }) => {
	expect(provider.model).toBe("gpt-test");
	const left = await requireAvailable(tools, "tmdb", "1396");
	const right = await requireAvailable(tools, "tvdb", "81189");
	expect(left.validated).toBe(true);
	expect(right.persisted.spokes).toHaveLength(2);
	return {
		proposals: [
			{
				claim: "tmdb:1396 and tvdb:81189 are the same title",
				evidence: [
					{
						kind: "api",
						official: true,
						operator: "tmdb",
						stance: "corroborates",
						url: left.url,
						validated: true,
					},
					{
						kind: "api",
						official: true,
						operator: "tvdb",
						stance: "corroborates",
						url: right.url,
						validated: true,
					},
				],
				kind: "title",
				left: left.ref,
				right: right.ref,
			},
		],
		residue: ["mal"],
	};
};

const singleSourceAgent: ResearchAgent = async ({ tools }) => {
	const left = await requireAvailable(tools, "tmdb", "1");
	const right = await requireAvailable(tools, "tvdb", "2");
	return {
		proposals: [
			{
				claim: "weak single-source claim",
				evidence: [
					{
						kind: "api",
						official: true,
						operator: "tmdb",
						stance: "corroborates",
						url: left.url,
						validated: true,
					},
				],
				kind: "title",
				left: left.ref,
				right: right.ref,
			},
		],
		residue: [],
	};
};

const weakRelationAgent: ResearchAgent = async ({ tools }) => {
	const from = await requireAvailable(tools, "tmdb", "1");
	const to = await requireAvailable(tools, "tvdb", "2");
	return {
		proposals: [
			{
				claim: "weak relation claim",
				evidence: [
					{
						kind: "api",
						official: true,
						operator: "tmdb",
						stance: "corroborates",
						url: from.url,
						validated: true,
					},
				],
				from: from.ref,
				kind: "relation",
				to: to.ref,
			},
		],
		residue: [],
	};
};

const emptyResidueAgent: ResearchAgent = async () => {
	await Promise.resolve();
	return {
		proposals: [],
		residue: ["tmdb", "tvdb", "mal"],
	};
};

const simklHintAgent: ResearchAgent = async ({ tools }) => {
	const hint = await tools.fetchSimklHint("999");
	expect(hint.kind).toBe("simkl-hint");
	expect(hint.entry.externalIds.mal).toBe("10");
	const left = await requireAvailable(tools, "tmdb", "100");
	const right = await requireAvailable(tools, "mal", "10");
	return {
		proposals: [
			{
				claim: "tmdb and mal via simkl hint",
				evidence: [
					{
						kind: "api",
						official: true,
						operator: "tmdb",
						stance: "corroborates",
						url: left.url,
						validated: true,
					},
					{
						kind: "api",
						official: true,
						operator: "mal",
						stance: "corroborates",
						url: right.url,
						validated: true,
					},
				],
				kind: "title",
				left: left.ref,
				right: right.ref,
			},
		],
		residue: [],
	};
};

const refuseWikiAgent: ResearchAgent = async ({ tools, continuity }) => {
	await expect(
		tools.scrapeOfficial({
			operator: "tmdb",
			url: "https://community-wiki.example/breaking-bad",
		}),
	).rejects.toThrow(/non-official/u);
	return { proposals: [], residue: continuity.targetServices };
};

const weakInstalmentAgent: ResearchAgent = async ({ tools }) => {
	const fetched = await requireAvailable(tools, "tmdb", "42");
	const spokeId = fetched.persisted.spokes[0]?.instalmentId;
	if (spokeId === undefined) {
		throw new Error("expected a spoke");
	}
	const scraped = await tools.scrapeOfficial({
		operator: "tmdb",
		url: "https://www.themoviedb.org/tv/42",
	});
	return {
		proposals: [
			{
				claim: "instalment covers unit",
				evidence: [
					{
						kind: "scrape",
						official: true,
						operator: "tmdb",
						stance: "corroborates",
						url: scraped.url,
					},
				],
				instalmentId: spokeId,
				kind: "instalment",
			},
		],
		residue: [],
	};
};

const multiUnitWeakInstalment =
	(unitAId: string, unitBId: string): ResearchAgent =>
	async ({ tools }) => {
		const fetched = await requireAvailable(tools, "tmdb", "42");
		const spokeId = fetched.persisted.spokes[0]?.instalmentId;
		if (spokeId === undefined) {
			throw new Error("expected a spoke");
		}
		const scraped = await tools.scrapeOfficial({
			operator: "tmdb",
			url: "https://www.themoviedb.org/tv/42",
		});
		const evidence = [
			{
				kind: "scrape" as const,
				official: true as const,
				operator: "tmdb",
				stance: "corroborates" as const,
				url: scraped.url,
			},
		];
		return {
			proposals: [
				{
					claim: "weak instalment unit a",
					evidence,
					instalmentId: spokeId,
					kind: "instalment",
					unitId: unitAId,
				},
				{
					claim: "weak instalment unit b",
					evidence,
					instalmentId: spokeId,
					kind: "instalment",
					unitId: unitBId,
				},
			],
			residue: [],
		};
	};

const silentSkipAgent: ResearchAgent = async ({ tools }) => {
	const left = await requireAvailable(tools, "tmdb", "1");
	const right = await requireAvailable(tools, "tvdb", "2");
	return {
		proposals: [
			{
				claim: "resolved pair only",
				evidence: [
					{
						kind: "api",
						official: true,
						operator: "tmdb",
						stance: "corroborates",
						url: left.url,
						validated: true,
					},
					{
						kind: "api",
						official: true,
						operator: "tvdb",
						stance: "corroborates",
						url: right.url,
						validated: true,
					},
				],
				kind: "title",
				left: left.ref,
				right: right.ref,
			},
		],
		residue: [],
	};
};

const unavailableContinueAgent: ResearchAgent = async ({
	tools,
	continuity,
}) => {
	const missing = await tools.fetchCatalogue("tmdb", "missing");
	expect(missing.unavailable).toBe(true);
	expect(missing.validated).toBe(false);
	return { proposals: [], residue: continuity.targetServices };
};

const malformedCatalogueAgent: ResearchAgent = async ({
	tools,
	continuity,
}) => {
	const bad = await tools.fetchCatalogue("tmdb", "broken");
	expect(bad.unavailable).toBe(true);
	expect(bad.validated).toBe(false);
	return { proposals: [], residue: continuity.targetServices };
};

const idempotentRelationAgent: ResearchAgent = async ({ tools }) => {
	const from = await requireAvailable(tools, "tmdb", "1");
	const to = await requireAvailable(tools, "tvdb", "2");
	const proposal = {
		claim: "idempotent relation",
		evidence: [
			{
				kind: "api" as const,
				official: true as const,
				operator: "tmdb",
				stance: "corroborates" as const,
				url: from.url,
				validated: true as const,
			},
		],
		from: from.ref,
		kind: "relation" as const,
		to: to.ref,
	};
	return { proposals: [proposal, proposal], residue: [] };
};

const oppositeDirectionRelationFlagsAgent: ResearchAgent = async ({
	tools,
}) => {
	const from = await requireAvailable(tools, "tmdb", "1");
	const to = await requireAvailable(tools, "tvdb", "2");
	const weak = {
		kind: "api" as const,
		official: true as const,
		operator: "tmdb",
		stance: "corroborates" as const,
		url: from.url,
		validated: true as const,
	};
	return {
		proposals: [
			{
				claim: "weak A to B",
				evidence: [weak],
				from: from.ref,
				kind: "relation",
				to: to.ref,
			},
			{
				claim: "weak B to A",
				evidence: [weak],
				from: to.ref,
				kind: "relation",
				to: from.ref,
			},
		],
		residue: [],
	};
};

const competingRelationAgent: ResearchAgent = async ({ tools }) => {
	const from = await requireAvailable(tools, "tmdb", "1");
	const firstTo = await requireAvailable(tools, "tvdb", "2");
	const rivalTo = await requireAvailable(tools, "mal", "3");
	const evidence = [
		{
			kind: "api" as const,
			official: true as const,
			operator: "tmdb",
			stance: "corroborates" as const,
			url: from.url,
			validated: true as const,
		},
	];
	return {
		proposals: [
			{
				claim: "first sequel",
				evidence,
				from: from.ref,
				kind: "relation",
				to: firstTo.ref,
			},
			{
				claim: "competing sequel",
				evidence,
				from: from.ref,
				kind: "relation",
				to: rivalTo.ref,
			},
		],
		residue: [],
	};
};

const idempotentInstalmentAgent =
	(unitId: string): ResearchAgent =>
	async ({ tools }) => {
		const fetched = await requireAvailable(tools, "tmdb", "42");
		const spokeId = fetched.persisted.spokes[0]?.instalmentId;
		if (spokeId === undefined) {
			throw new Error("expected a spoke");
		}
		const proposal = {
			claim: "idempotent instalment",
			evidence: [
				{
					kind: "api" as const,
					official: true as const,
					operator: "tmdb",
					stance: "corroborates" as const,
					url: fetched.url,
					validated: true as const,
				},
			],
			instalmentId: spokeId,
			kind: "instalment" as const,
			unitId,
		};
		return { proposals: [proposal, proposal], residue: [] };
	};

describe("research timing policy", () => {
	it("runs only when the configured timing matches the pipeline phase", () => {
		expect(shouldRunResearch("before-builds", "before-builds")).toBe(true);
		expect(shouldRunResearch("before-builds", "after-residue")).toBe(false);
		expect(shouldRunResearch("after-residue", "after-residue")).toBe(true);
		expect(shouldRunResearch("off", "before-builds")).toBe(false);
	});

	it("round-trips through the timing-config reader stub", async () => {
		const store = createMemoryTimingStore("off");
		expect(await store.read()).toBe("off");
		await store.write("after-residue");
		expect(await store.read()).toBe("after-residue");
	});
});

describe("official operator domains", () => {
	it("admits official hosts and refuses community wikis", () => {
		expect(
			isOfficialOperatorUrl("https://api.themoviedb.org/3/tv/1396", "tmdb"),
		).toBe(true);
		expect(
			isOfficialOperatorUrl("https://wiki.anidb.net/something", "anidb"),
		).toBe(false);
		expect(isOfficialOperatorUrl("https://fanwiki.example/page")).toBe(false);
	});
});

describe("runResearchPass timing gates", () => {
	let db: TestDb;
	let masterKey: string;
	let providerId: string;
	let continuity: ResearchContinuity;

	beforeEach(async () => {
		db = await freshDb();
		masterKey = randomMasterKey();
		const stored = await storeProvider(db, masterKey, {
			config: { apiKey: "sk-test", kind: "openai", model: "gpt-test" },
			label: "research-test",
		});
		providerId = stored.id;
		const group = await seedGroup(db);
		continuity = {
			groupId: group.id,
			id: `group:${group.id}`,
			targetServices: ["tmdb", "tvdb", "mal"],
		};
	});

	it("runs nothing when timing is off and returns full residue", async () => {
		let agentCalls = 0;
		const agent: ResearchAgent = async () => {
			await Promise.resolve();
			agentCalls += 1;
			return { proposals: [], residue: [] };
		};

		const outcome = await runResearchPass(continuity, "before-builds", {
			agent,
			clients: {},
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			timing: createMemoryTimingStore("off"),
		});

		expect(outcome).toEqual({
			kind: "skipped",
			reason: "timing-off",
			residue: ["tmdb", "tvdb", "mal"],
		});
		expect(agentCalls).toBe(0);
		expect(await db.select().from(titleAssertions).all()).toHaveLength(0);
	});

	it("skips when the phase does not match the configured timing", async () => {
		const outcome = await runResearchPass(continuity, "before-builds", {
			agent: emptyResidueAgent,
			clients: {},
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			timing: createMemoryTimingStore("after-residue"),
		});
		expect(outcome.kind).toBe("skipped");
		if (outcome.kind === "skipped") {
			expect(outcome.reason).toBe("timing-mismatch");
			expect(outcome.residue).toEqual(["tmdb", "tvdb", "mal"]);
		}
	});
});

describe("runResearchPass publish path", () => {
	let db: TestDb;
	let masterKey: string;
	let providerId: string;
	let continuity: ResearchContinuity;

	beforeEach(async () => {
		db = await freshDb();
		masterKey = randomMasterKey();
		const stored = await storeProvider(db, masterKey, {
			config: { apiKey: "sk-test", kind: "openai", model: "gpt-test" },
			label: "research-test",
		});
		providerId = stored.id;
		const group = await seedGroup(db);
		continuity = {
			groupId: group.id,
			id: `group:${group.id}`,
			targetServices: ["tmdb", "tvdb", "mal"],
		};
	});

	it("persists tool outputs as spokes and publishes llm-research without a second fetch", async () => {
		const tmdb = catalogue({
			instalments: [{ locator: "1:1" }, { locator: "1:2" }],
			title: "Breaking Bad",
		});
		const tvdb = catalogue({
			instalments: [{ locator: "1:1" }, { locator: "1:2" }],
			title: "Breaking Bad",
		});
		let tmdbFetches = 0;
		const clients = {
			tmdb: {
				fetchCatalogue: async (id: string) => {
					await Promise.resolve();
					tmdbFetches += 1;
					return { ...tmdb, id };
				},
				fetchTitle: async () => {
					await Promise.resolve();
					return tmdb;
				},
			},
			tvdb: clientFor({ "81189": tvdb }),
		};

		const reviews: { claim: string }[] = [];
		const outcome = await runResearchPass(continuity, "before-builds", {
			agent: highTitleAgent,
			clients,
			db,
			enqueueReview: async (proposal) => {
				await Promise.resolve();
				reviews.push({ claim: proposal.claim });
			},
			masterKey,
			providerId,
			simkl: simklClient(simklEntry()),
			timing: createMemoryTimingStore("before-builds"),
		});

		expect(outcome.kind).toBe("completed");
		if (outcome.kind !== "completed") {
			return;
		}
		expect(outcome.residue).toEqual(["mal"]);
		expect(outcome.published).toHaveLength(1);
		expect(outcome.published[0]?.confidence).toBe("high");

		const titles = await db.select().from(serviceTitles).all();
		expect(titles).toHaveLength(2);
		expect(await db.select().from(serviceInstalments).all()).toHaveLength(4);

		const assertions = await db.select().from(titleAssertions).all();
		expect(assertions).toHaveLength(1);
		expect(assertions[0]?.source).toBe("llm-research");
		expect(assertions[0]?.confidence).toBe("high");
		expect(reviews).toHaveLength(1);

		expect(tmdbFetches).toBe(1);
		const [firstTitle] = titles;
		const stillThere = await db
			.select()
			.from(serviceInstalments)
			.where(eq(serviceInstalments.titleId, firstTitle?.id ?? -1))
			.all();
		expect(stillThere.length).toBeGreaterThan(0);
	});

	it("caps a single-source proposal at low confidence and still enqueues review", async () => {
		const outcome = await runResearchPass(continuity, "after-residue", {
			agent: singleSourceAgent,
			clients: {
				tmdb: clientFor({
					"1": catalogue({ instalments: [{ locator: "1:1" }], title: "Alone" }),
				}),
				tvdb: clientFor({
					"2": catalogue({ instalments: [{ locator: "1:1" }], title: "Alone" }),
				}),
			},
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			timing: createMemoryTimingStore("after-residue"),
		});

		expect(outcome.kind).toBe("completed");
		if (outcome.kind !== "completed") {
			return;
		}
		expect(outcome.published[0]?.confidence).toBe("low");
		expect(outcome.published[0]?.reviewFlag).toBe("low-confidence-flag");
		expect(await db.select().from(titleAssertions).all()).toMatchObject([
			{ confidence: "low", source: "llm-research" },
		]);
		const flags = await db.select().from(pendingGroupCandidates).all();
		expect(flags).toHaveLength(1);
		expect(flags[0]?.kind).toBe("low-confidence-flag");
		expect(flags[0]?.evidence).toMatchObject({ target: "title" });
		expect(flags[0]?.subject).toMatchObject({ subjectType: "title-pair" });
		expect(outcome.published[0]?.review.evidence[0]?.url).toBe(
			"https://api.themoviedb.org",
		);
	});

	it("does not rewrite confidence on a higher-precedence assertion", async () => {
		const clients = {
			tmdb: clientFor({
				"1": catalogue({ instalments: [{ locator: "1:1" }], title: "Alone" }),
			}),
			tvdb: clientFor({
				"2": catalogue({ instalments: [{ locator: "1:1" }], title: "Alone" }),
			}),
		};
		const first = await runResearchPass(continuity, "after-residue", {
			agent: singleSourceAgent,
			clients,
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			timing: createMemoryTimingStore("after-residue"),
		});
		expect(first.kind).toBe("completed");
		const [seeded] = await db.select().from(titleAssertions).all();
		expect(seeded).toBeDefined();
		if (seeded === undefined) {
			return;
		}
		await db
			.update(titleAssertions)
			.set({ confidence: "high", source: "manual" })
			.where(eq(titleAssertions.id, seeded.id))
			.run();
		const flagsBefore = await db.select().from(pendingGroupCandidates).all();

		const second = await runResearchPass(continuity, "after-residue", {
			agent: singleSourceAgent,
			clients,
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			timing: createMemoryTimingStore("after-residue"),
		});
		expect(second.kind).toBe("completed");
		expect(await db.select().from(titleAssertions).all()).toMatchObject([
			{ confidence: "high", id: seeded.id, source: "manual" },
		]);
		expect(await db.select().from(pendingGroupCandidates).all()).toHaveLength(
			flagsBefore.length,
		);
	});

	it("queues a low-confidence flag for a weak relation proposal", async () => {
		const outcome = await runResearchPass(continuity, "after-residue", {
			agent: weakRelationAgent,
			clients: {
				tmdb: clientFor({
					"1": catalogue({ instalments: [{ locator: "1:1" }], title: "From" }),
				}),
				tvdb: clientFor({
					"2": catalogue({ instalments: [{ locator: "1:1" }], title: "To" }),
				}),
			},
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			timing: createMemoryTimingStore("after-residue"),
		});

		expect(outcome.kind).toBe("completed");
		if (outcome.kind !== "completed") {
			return;
		}
		expect(outcome.published[0]?.confidence).toBe("low");
		expect(outcome.published[0]?.reviewFlag).toBe("low-confidence-flag");
		expect(await db.select().from(relationAssertions).all()).toMatchObject([
			{ confidence: "low", source: "llm-research" },
		]);
		const flags = await db.select().from(pendingGroupCandidates).all();
		expect(flags).toHaveLength(1);
		expect(flags[0]?.kind).toBe("low-confidence-flag");
		expect(flags[0]?.evidence).toMatchObject({ target: "relation" });
		expect(flags[0]?.subject).toMatchObject({ subjectType: "title-pair" });
	});

	it("enqueues published proposals for the #61 reviewer without adjudicating inline", async () => {
		const enqueued: string[] = [];
		const outcome = await runResearchPass(continuity, "after-residue", {
			agent: singleSourceAgent,
			clients: {
				tmdb: clientFor({
					"1": catalogue({ instalments: [{ locator: "1:1" }], title: "Alone" }),
				}),
				tvdb: clientFor({
					"2": catalogue({ instalments: [{ locator: "1:1" }], title: "Alone" }),
				}),
			},
			db,
			enqueueReview: async (proposal) => {
				await Promise.resolve();
				enqueued.push(proposal.claim);
			},
			masterKey,
			providerId,
			timing: createMemoryTimingStore("after-residue"),
		});

		expect(outcome.kind).toBe("completed");
		expect(enqueued).toEqual(["weak single-source claim"]);
	});

	it("leaves unresolved residue for the deterministic fan-out", async () => {
		const outcome = await runResearchPass(continuity, "before-builds", {
			agent: emptyResidueAgent,
			clients: {},
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			timing: createMemoryTimingStore("before-builds"),
		});
		expect(outcome).toMatchObject({
			kind: "completed",
			published: [],
			residue: ["tmdb", "tvdb", "mal"],
		});
	});
});

describe("runResearchPass tools", () => {
	let db: TestDb;
	let masterKey: string;
	let providerId: string;
	let continuity: ResearchContinuity;

	beforeEach(async () => {
		db = await freshDb();
		masterKey = randomMasterKey();
		const stored = await storeProvider(db, masterKey, {
			config: { apiKey: "sk-test", kind: "openai", model: "gpt-test" },
			label: "research-test",
		});
		providerId = stored.id;
		const group = await seedGroup(db);
		continuity = {
			groupId: group.id,
			id: `group:${group.id}`,
			targetServices: ["tmdb", "tvdb", "mal"],
		};
	});

	it("uses SIMKL as a hint without counting it toward corroboration", async () => {
		const entry = simklEntry({
			externalIds: { mal: "10", tmdb: "100" },
			id: "999",
		});
		const outcome = await runResearchPass(continuity, "before-builds", {
			agent: simklHintAgent,
			clients: {
				mal: clientFor({
					"10": catalogue({
						instalments: [{ locator: "s1e1" }],
						title: "Hinted",
					}),
				}),
				tmdb: clientFor({
					"100": catalogue({
						instalments: [{ locator: "s1e1" }],
						title: "Hinted",
					}),
				}),
			},
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			simkl: simklClient(entry),
			timing: createMemoryTimingStore("before-builds"),
		});

		expect(outcome.kind).toBe("completed");
		if (outcome.kind === "completed") {
			expect(outcome.published[0]?.confidence).toBe("high");
		}
		const titleRows = await db.select().from(serviceTitles).all();
		const services = titleRows.map((row) => row.service);
		expect(services.toSorted()).toEqual(["mal", "tmdb"]);
	});

	it("refuses scrape tools aimed at non-official domains", async () => {
		await runResearchPass(continuity, "before-builds", {
			agent: refuseWikiAgent,
			clients: {},
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			scrape: {
				fetchPage: async () => {
					await Promise.resolve();
					return { ok: true };
				},
			},
			timing: createMemoryTimingStore("before-builds"),
		});
	});

	it("queues a low-confidence flag for a weak instalment proposal", async () => {
		const outcome = await runResearchPass(continuity, "before-builds", {
			agent: weakInstalmentAgent,
			clients: {
				tmdb: clientFor({
					"42": catalogue({
						instalments: [{ locator: "1:1" }],
						title: "Flagged",
					}),
				}),
			},
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			scrape: {
				fetchPage: async () => {
					await Promise.resolve();
					return { ok: true };
				},
			},
			timing: createMemoryTimingStore("before-builds"),
		});

		expect(outcome.kind).toBe("completed");
		const flags = await db.select().from(pendingGroupCandidates).all();
		expect(flags).toHaveLength(1);
		expect(flags[0]?.kind).toBe("low-confidence-flag");
		expect(flags[0]?.evidence).toMatchObject({ target: "instalment" });
		if (outcome.kind === "completed") {
			expect(outcome.published[0]?.review.evidence[0]?.url).toBe(
				"https://www.themoviedb.org/tv/42",
			);
		}
	});

	it("queues an instalment-assertion-conflict for a second unit on one spoke", async () => {
		const unitA = one(
			await db.insert(contentUnits).values({}).returning().all(),
		);
		const unitB = one(
			await db.insert(contentUnits).values({}).returning().all(),
		);
		const outcome = await runResearchPass(continuity, "before-builds", {
			agent: multiUnitWeakInstalment(unitA.id, unitB.id),
			clients: {
				tmdb: clientFor({
					"42": catalogue({
						instalments: [{ locator: "1:1" }],
						title: "Flagged",
					}),
				}),
			},
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			scrape: {
				fetchPage: async () => {
					await Promise.resolve();
					return { ok: true };
				},
			},
			timing: createMemoryTimingStore("before-builds"),
		});

		expect(outcome.kind).toBe("completed");
		if (outcome.kind === "completed") {
			expect(outcome.published).toHaveLength(1);
		}
		expect(await db.select().from(instalmentAssertions).all()).toHaveLength(1);
		const pending = await db.select().from(pendingGroupCandidates).all();
		expect(pending.some((row) => row.kind === "low-confidence-flag")).toBe(
			true,
		);
		expect(
			pending.some((row) => row.kind === "instalment-assertion-conflict"),
		).toBe(true);
	});

	it("reuses curated instalment coverage instead of minting a rival unit", async () => {
		const clients = {
			tmdb: clientFor({
				"42": catalogue({
					instalments: [{ locator: "1:1" }],
					title: "Curated",
				}),
			}),
		};
		const first = await runResearchPass(continuity, "before-builds", {
			agent: weakInstalmentAgent,
			clients,
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			scrape: {
				fetchPage: async () => {
					await Promise.resolve();
					return { ok: true };
				},
			},
			timing: createMemoryTimingStore("before-builds"),
		});
		expect(first.kind).toBe("completed");
		const [seeded] = await db.select().from(instalmentAssertions).all();
		expect(seeded).toBeDefined();
		if (seeded === undefined) {
			return;
		}
		await db
			.update(instalmentAssertions)
			.set({ confidence: "high", source: "manual" })
			.where(eq(instalmentAssertions.id, seeded.id))
			.run();
		const pendingBefore = await db.select().from(pendingGroupCandidates).all();

		const second = await runResearchPass(continuity, "before-builds", {
			agent: weakInstalmentAgent,
			clients,
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			scrape: {
				fetchPage: async () => {
					await Promise.resolve();
					return { ok: true };
				},
			},
			timing: createMemoryTimingStore("before-builds"),
		});
		expect(second.kind).toBe("completed");
		expect(await db.select().from(instalmentAssertions).all()).toMatchObject([
			{
				confidence: "high",
				id: seeded.id,
				source: "manual",
				unitId: seeded.unitId,
			},
		]);
		expect(await db.select().from(pendingGroupCandidates).all()).toHaveLength(
			pendingBefore.length,
		);
	});

	it("treats an undefined catalogue as unavailable without aborting the pass", async () => {
		const outcome = await runResearchPass(continuity, "before-builds", {
			agent: unavailableContinueAgent,
			clients: {
				tmdb: {
					fetchTitle: async () => {
						await Promise.resolve();
						return;
					},
					requestUrl: () => "https://api.themoviedb.org/3/tv/missing",
				},
			},
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			timing: createMemoryTimingStore("before-builds"),
		});
		expect(outcome).toMatchObject({
			kind: "completed",
			published: [],
			residue: ["tmdb", "tvdb", "mal"],
		});
		expect(await db.select().from(serviceTitles).all()).toHaveLength(0);
	});

	it("treats a malformed catalogue payload as unavailable without aborting", async () => {
		const outcome = await runResearchPass(continuity, "before-builds", {
			agent: malformedCatalogueAgent,
			clients: {
				tmdb: {
					fetchCatalogue: async () => {
						await Promise.resolve();
						return { instalmentCount: 1 };
					},
					fetchTitle: async () => {
						await Promise.resolve();
						return;
					},
					requestUrl: () => "https://api.themoviedb.org/3/tv/broken",
				},
			},
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			timing: createMemoryTimingStore("before-builds"),
		});
		expect(outcome).toMatchObject({
			kind: "completed",
			published: [],
			residue: ["tmdb", "tvdb", "mal"],
		});
		expect(await db.select().from(serviceTitles).all()).toHaveLength(0);
	});

	it("keeps silently skipped target services in residue", async () => {
		const outcome = await runResearchPass(continuity, "before-builds", {
			agent: silentSkipAgent,
			clients: {
				tmdb: clientFor({
					"1": catalogue({ instalments: [{ locator: "1:1" }], title: "A" }),
				}),
				tvdb: clientFor({
					"2": catalogue({ instalments: [{ locator: "1:1" }], title: "A" }),
				}),
			},
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			timing: createMemoryTimingStore("before-builds"),
		});
		expect(outcome).toMatchObject({
			kind: "completed",
			residue: ["mal"],
		});
	});

	it("re-publishing the same relation does not UNIQUE-crash", async () => {
		const outcome = await runResearchPass(continuity, "before-builds", {
			agent: idempotentRelationAgent,
			clients: {
				tmdb: clientFor({
					"1": catalogue({ instalments: [{ locator: "1:1" }], title: "From" }),
				}),
				tvdb: clientFor({
					"2": catalogue({ instalments: [{ locator: "1:1" }], title: "To" }),
				}),
			},
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			timing: createMemoryTimingStore("before-builds"),
		});
		expect(outcome.kind).toBe("completed");
		if (outcome.kind === "completed") {
			expect(outcome.published).toHaveLength(2);
			expect(outcome.published[0]?.assertionId).toBe(
				outcome.published[1]?.assertionId,
			);
		}
		expect(await db.select().from(relationAssertions).all()).toHaveLength(1);
	});

	it("queues a continuity-conflict for a reverse-direction relation", async () => {
		const outcome = await runResearchPass(continuity, "before-builds", {
			agent: oppositeDirectionRelationFlagsAgent,
			clients: {
				tmdb: clientFor({
					"1": catalogue({ instalments: [{ locator: "1:1" }], title: "A" }),
				}),
				tvdb: clientFor({
					"2": catalogue({ instalments: [{ locator: "1:1" }], title: "B" }),
				}),
			},
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			timing: createMemoryTimingStore("before-builds"),
		});
		expect(outcome.kind).toBe("completed");
		if (outcome.kind === "completed") {
			expect(outcome.published).toHaveLength(1);
		}
		expect(await db.select().from(relationAssertions).all()).toHaveLength(1);
		const pending = await db.select().from(pendingGroupCandidates).all();
		expect(pending.some((row) => row.kind === "low-confidence-flag")).toBe(
			true,
		);
		expect(pending.some((row) => row.kind === "continuity-conflict")).toBe(
			true,
		);
	});

	it("queues competing relations instead of aborting the pass", async () => {
		const outcome = await runResearchPass(continuity, "before-builds", {
			agent: competingRelationAgent,
			clients: {
				mal: clientFor({
					"3": catalogue({ instalments: [{ locator: "1:1" }], title: "Rival" }),
				}),
				tmdb: clientFor({
					"1": catalogue({ instalments: [{ locator: "1:1" }], title: "From" }),
				}),
				tvdb: clientFor({
					"2": catalogue({ instalments: [{ locator: "1:1" }], title: "First" }),
				}),
			},
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			timing: createMemoryTimingStore("before-builds"),
		});
		expect(outcome.kind).toBe("completed");
		if (outcome.kind === "completed") {
			expect(outcome.published).toHaveLength(1);
		}
		expect(await db.select().from(relationAssertions).all()).toHaveLength(1);
		const pending = await db.select().from(pendingGroupCandidates).all();
		const conflicts = pending.filter(
			(row) => row.kind === "continuity-conflict",
		);
		expect(conflicts).toHaveLength(1);
		expect(conflicts[0]?.evidence).toMatchObject({
			kind: "continuity-conflict",
		});
	});

	it("re-publishing the same instalment unit does not UNIQUE-crash", async () => {
		const unit = one(
			await db.insert(contentUnits).values({}).returning().all(),
		);
		const outcome = await runResearchPass(continuity, "before-builds", {
			agent: idempotentInstalmentAgent(unit.id),
			clients: {
				tmdb: clientFor({
					"42": catalogue({
						instalments: [{ locator: "1:1" }],
						title: "Show",
					}),
				}),
			},
			db,
			enqueueReview: noopReview,
			masterKey,
			providerId,
			timing: createMemoryTimingStore("before-builds"),
		});
		expect(outcome.kind).toBe("completed");
		if (outcome.kind === "completed") {
			expect(outcome.published).toHaveLength(2);
			expect(outcome.published[0]?.assertionId).toBe(
				outcome.published[1]?.assertionId,
			);
		}
		expect(await db.select().from(instalmentAssertions).all()).toHaveLength(1);
	});
});
