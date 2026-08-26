import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import {
	pendingGroupCandidates,
	serviceInstalments,
	serviceTitles,
	titleAssertions,
	titleGroups,
} from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import type { CatalogueTitle, SimklClient, SimklEntry } from "@/engine/discovery";
import { storeProvider } from "@/lib/provider-config";
import { randomMasterKey } from "@/lib/provider-config/test-support.ts";

import { isOfficialOperatorUrl } from "./domains.ts";
import { runResearchPass } from "./orchestrate.ts";
import type { ResearchAgent, ResearchContinuity } from "./orchestrate.ts";
import {
	createMemoryTimingStore,
	shouldRunResearch,
} from "./timing.ts";
import type { ResearchCatalogueClient } from "./tools.ts";

type TestDb = Awaited<ReturnType<typeof freshDb>>;

const one = <Row>(rows: readonly Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected a row");
	}
	return row;
};

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

const highTitleAgent: ResearchAgent = async ({ tools, provider }) => {
	expect(provider.model).toBe("gpt-test");
	const left = await tools.fetchCatalogue("tmdb", "1396");
	const right = await tools.fetchCatalogue("tvdb", "81189");
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
						validated: true,
					},
					{
						kind: "api",
						official: true,
						operator: "tvdb",
						stance: "corroborates",
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
	const left = await tools.fetchCatalogue("tmdb", "1");
	const right = await tools.fetchCatalogue("tvdb", "2");
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
	const left = await tools.fetchCatalogue("tmdb", "100");
	const right = await tools.fetchCatalogue("mal", "10");
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
						validated: true,
					},
					{
						kind: "api",
						official: true,
						operator: "mal",
						stance: "corroborates",
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
	const fetched = await tools.fetchCatalogue("tmdb", "42");
	const spokeId = fetched.persisted.spokes[0]?.instalmentId;
	if (spokeId === undefined) {
		throw new Error("expected a spoke");
	}
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
					},
				],
				instalmentId: spokeId,
				kind: "instalment",
			},
		],
		residue: [],
	};
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
	});

	it("leaves unresolved residue for the deterministic fan-out", async () => {
		const outcome = await runResearchPass(continuity, "before-builds", {
			agent: emptyResidueAgent,
			clients: {},
			db,
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
			timing: createMemoryTimingStore("before-builds"),
		});

		expect(outcome.kind).toBe("completed");
		const flags = await db.select().from(pendingGroupCandidates).all();
		expect(flags).toHaveLength(1);
		expect(flags[0]?.kind).toBe("low-confidence-flag");
	});
});
