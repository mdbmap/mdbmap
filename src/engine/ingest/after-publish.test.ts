import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import {
	pendingGroupCandidates,
	serviceTitles,
	titleGroups,
} from "@/db/engine-schema";
import { freshDb } from "@/db/test-helpers";
import type {
	FuzzySearchClients,
	VerificationClients,
} from "@/engine/discovery";

import { scheduleAfterPublishFuzzy } from "./after-publish.ts";

const one = <Row>(rows: readonly Row[]): Row => {
	const [row] = rows;
	if (row === undefined) {
		throw new Error("expected an inserted row");
	}
	return row;
};

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
