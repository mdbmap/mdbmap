import { beforeEach, describe, expect, it } from "vitest";

import { personalRating, user } from "@/db/schema";
import { freshDb } from "@/db/test-helpers";
import type { RateableUnit } from "@/orpc/schema";

import { communityScoreProvider } from "./community.ts";

describe("community score derivation", () => {
	let db: Awaited<ReturnType<typeof freshDb>>;
	const part: RateableUnit = { key: "part:demo:0", kind: "part" };
	const episode: RateableUnit = { key: "episode:demo:1", kind: "episode" };

	const rate = async (userId: string, unit: RateableUnit, score: number) =>
		db
			.insert(personalRating)
			.values({ score, unitKey: unit.key, unitKind: unit.kind, userId })
			.run();

	beforeEach(async () => {
		db = await freshDb();
		await Promise.all(
			["user-1", "user-2", "user-3"].map(async (id) =>
				db.insert(user).values({ email: `${id}@b.test`, id, name: id }).run(),
			),
		);
	});

	it("averages every user's rating for the unit with a count", async () => {
		await rate("user-1", part, 6);
		await rate("user-2", part, 8);
		await rate("user-3", part, 10);

		expect(await communityScoreProvider.scoreFor(part, db)).toEqual({
			count: 3,
			mean: 8,
		});
	});

	it("has no score when nobody has rated the unit", async () => {
		expect(await communityScoreProvider.scoreFor(part, db)).toEqual({
			count: 0,
			mean: undefined,
		});
	});

	it("aggregates each unit independently and never leaks across them", async () => {
		await rate("user-1", part, 4);
		await rate("user-2", part, 6);
		await rate("user-3", episode, 10);

		expect(await communityScoreProvider.scoreFor(part, db)).toEqual({
			count: 2,
			mean: 5,
		});
		expect(await communityScoreProvider.scoreFor(episode, db)).toEqual({
			count: 1,
			mean: 10,
		});
	});
});
