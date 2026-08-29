import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
	pendingGroupCandidates,
	serviceTitles,
	titleAssertions,
	titleGroups,
} from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import type {
	FuzzySearchClients,
	VerificationClients,
} from "@/engine/discovery";
import {
	coverageStateFor,
	groupCoverageKey,
} from "@/engine/overflow/coverage.ts";
import { createMemoryTimingStore } from "@/engine/research";
import type { ResearchAgent, ResearchProposal } from "@/engine/research";
import { storeProvider } from "@/lib/provider-config";
import { randomMasterKey } from "@/lib/provider-config/test-support.ts";

import {
	scheduleAfterPublishFuzzy,
	scheduleAfterPublishResearch,
} from "./after-publish.ts";
import type { AfterPublishResearchConfig } from "./after-publish.ts";
import { finishPublish } from "./publish.ts";

const one = <Row>(rows: readonly Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected an inserted row");
	}
	return row;
};

const noopReview = async (): Promise<void> => {
	await Promise.resolve();
};

const countingAgent =
	(calls: { count: number }): ResearchAgent =>
	() => {
		calls.count += 1;
		return { proposals: [], residue: [] };
	};

const researchConfig = (input: {
	readonly agent: ResearchAgent;
	readonly masterKey: string;
	readonly providerId: string;
	readonly timing: "after-residue" | "off";
}): AfterPublishResearchConfig => ({
	deps: {
		agent: input.agent,
		clients: {},
		enqueueReview: noopReview,
		masterKey: input.masterKey,
		providerId: input.providerId,
		timing: createMemoryTimingStore(input.timing),
	},
});

const seedGroup = async (db: Awaited<ReturnType<typeof freshDb>>) => {
	const group = one(
		await db
			.insert(titleGroups)
			.values({ source: "t1-structure" })
			.returning()
			.all(),
	);
	await db
		.insert(serviceTitles)
		.values([
			{ groupId: group.id, ordinal: 0, service: "tmdb", serviceId: "1" },
			{ groupId: group.id, ordinal: 1, service: "tvdb", serviceId: "2" },
		])
		.run();
	return group;
};

const researchProposal = (left: number, right: number): ResearchProposal => ({
	claim: "the titles match",
	evidence: [
		{
			kind: "api",
			official: true,
			operator: "tmdb",
			stance: "corroborates",
			url: "https://api.themoviedb.org",
			validated: true,
		},
		{
			kind: "api",
			official: true,
			operator: "tvdb",
			stance: "corroborates",
			url: "https://api4.thetvdb.com",
			validated: true,
		},
	],
	kind: "title",
	left: { service: "tmdb", serviceId: String(left) },
	right: { service: "tvdb", serviceId: String(right) },
});

describe("post-publish fuzzy discovery", () => {
	it("invokes the scheduler and queues a candidate from catalogue metadata", async () => {
		const db = await freshDb();
		const group = one(
			await db
				.insert(titleGroups)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		const subject = one(
			await db
				.insert(serviceTitles)
				.values({
					groupId: group.id,
					ordinal: 0,
					service: "tmdb",
					serviceId: "1",
				})
				.returning()
				.all(),
		);
		await db
			.insert(serviceTitles)
			.values({
				groupId: group.id,
				ordinal: 1,
				service: "imdb",
				serviceId: "tt1",
			})
			.run();
		const catalogues: VerificationClients = {
			imdb: {
				fetchTitle: () => ({
					format: "movie",
					instalmentCount: undefined,
					releaseDate: "1998-04-03",
					title: "Cowboy Bebop",
				}),
			},
			tmdb: {
				fetchTitle: () => ({
					format: "movie",
					instalmentCount: undefined,
					releaseDate: "1998-04-03",
					title: "Cowboy Bebop",
				}),
			},
		};
		const clients: FuzzySearchClients = {
			imdb: {
				search: () => [
					{ serviceId: "tt10", title: "Cowboy Bebop", year: 1998 },
				],
			},
		};
		let scheduled: Promise<void> | undefined;

		scheduleAfterPublishFuzzy({
			catalogues,
			clients,
			db,
			groupId: group.id,
			scheduler: (task) => {
				scheduled = task;
			},
		});

		expect(scheduled).toBeDefined();
		if (scheduled === undefined) {
			throw new Error("expected fuzzy discovery to be scheduled");
		}
		await scheduled;
		const rows = await db
			.select()
			.from(pendingGroupCandidates)
			.where(eq(pendingGroupCandidates.subjectKey, `title:${subject.id}`))
			.all();
		expect(rows).toHaveLength(1);
		expect(rows[0]?.kind).toBe("fuzzy-group");
		expect(await db.select().from(serviceTitles).all()).toHaveLength(2);
	});

	it("skips catalogue lookups that throw and still queues from surviving titles", async () => {
		const db = await freshDb();
		const group = one(
			await db
				.insert(titleGroups)
				.values({ source: "t1-structure" })
				.returning()
				.all(),
		);
		const subject = one(
			await db
				.insert(serviceTitles)
				.values({
					groupId: group.id,
					ordinal: 0,
					service: "tmdb",
					serviceId: "1",
				})
				.returning()
				.all(),
		);
		await db
			.insert(serviceTitles)
			.values({
				groupId: group.id,
				ordinal: 1,
				service: "imdb",
				serviceId: "tt1",
			})
			.run();
		const catalogues: VerificationClients = {
			imdb: {
				fetchTitle: () => {
					throw new Error("catalogue unavailable");
				},
			},
			tmdb: {
				fetchTitle: () => ({
					format: "movie",
					instalmentCount: undefined,
					releaseDate: "1998-04-03",
					title: "Cowboy Bebop",
				}),
			},
		};
		const clients: FuzzySearchClients = {
			tmdb: {
				search: () => [{ serviceId: "10", title: "Cowboy Bebop", year: 1998 }],
			},
		};
		let scheduled: Promise<void> | undefined;

		scheduleAfterPublishFuzzy({
			catalogues,
			clients,
			db,
			groupId: group.id,
			scheduler: (task) => {
				scheduled = task;
			},
		});

		expect(scheduled).toBeDefined();
		if (scheduled === undefined) {
			throw new Error("expected fuzzy discovery to be scheduled");
		}
		await scheduled;
		const rows = await db
			.select()
			.from(pendingGroupCandidates)
			.where(eq(pendingGroupCandidates.subjectKey, `title:${subject.id}`))
			.all();
		expect(rows).toHaveLength(1);
	});
});

describe("post-publish research", () => {
	it("publishes proposals after residue through finishPublish", async () => {
		const db = await freshDb();
		const group = await seedGroup(db);
		const masterKey = randomMasterKey();
		const provider = await storeProvider(db, masterKey, {
			config: { apiKey: "sk-test", kind: "openai", model: "gpt-test" },
			label: "research-test",
		});
		const scheduled: Promise<void>[] = [];

		await finishPublish(db, {
			afterPublish: {
				catalogues: {},
				clients: {},
				research: researchConfig({
					agent: () => ({
						proposals: [researchProposal(1, 2)],
						residue: [],
					}),
					masterKey,
					providerId: provider.id,
					timing: "after-residue",
				}),
				scheduler: (task) => {
					scheduled.push(task);
				},
			},
			continuity: groupCoverageKey(group.id),
			groupId: group.id,
			ladderComplete: false,
			revision: 1,
			targetService: "tmdb",
		});

		expect(scheduled.length).toBeGreaterThan(0);
		await Promise.all(scheduled);
		expect(await db.select().from(titleAssertions).all()).toHaveLength(1);
	});

	it("does not invoke an off-timing research pass", async () => {
		const db = await freshDb();
		const calls = { count: 0 };
		const scheduled: Promise<void>[] = [];

		scheduleAfterPublishResearch({
			continuity: groupCoverageKey(1),
			db,
			deps: researchConfig({
				agent: countingAgent(calls),
				masterKey: randomMasterKey(),
				providerId: "missing",
				timing: "off",
			}).deps,
			groupId: 1,
			residue: ["tmdb"],
			scheduler: (task) => {
				scheduled.push(task);
			},
		});

		expect(scheduled).toHaveLength(1);
		await Promise.all(scheduled);
		expect(calls.count).toBe(0);
	});

	it("does not invoke research when matcher residue is empty", async () => {
		const calls = { count: 0 };

		scheduleAfterPublishResearch({
			continuity: groupCoverageKey(1),
			db: await freshDb(),
			deps: researchConfig({
				agent: countingAgent(calls),
				masterKey: randomMasterKey(),
				providerId: "missing",
				timing: "after-residue",
			}).deps,
			groupId: 1,
			residue: [],
			scheduler: () => {
				throw new Error("scheduler should not be called");
			},
		});

		expect(calls.count).toBe(0);
	});

	it("isolates research failure from the completed publish", async () => {
		const db = await freshDb();
		const group = await seedGroup(db);
		const scheduled: Promise<void>[] = [];

		const result = await finishPublish(db, {
			afterPublish: {
				catalogues: {},
				clients: {},
				research: researchConfig({
					agent: () => ({
						proposals: [],
						residue: [],
					}),
					masterKey: randomMasterKey(),
					providerId: "missing",
					timing: "after-residue",
				}),
				scheduler: (task) => {
					scheduled.push(task);
				},
			},
			continuity: groupCoverageKey(group.id),
			groupId: group.id,
			ladderComplete: false,
			revision: 1,
			targetService: "tmdb",
		});

		expect(result).toEqual({ groupId: group.id, kind: "published" });
		expect(scheduled.length).toBeGreaterThan(0);
		await Promise.all(scheduled);
		expect(
			await coverageStateFor(db, groupCoverageKey(group.id), 1, "tmdb"),
		).toBe("open");
	});
});
