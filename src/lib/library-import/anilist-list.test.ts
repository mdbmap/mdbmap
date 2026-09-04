import { describe, expect, it, vi } from "vitest";

import { fetchAnilistAnimeList } from "./anilist-list.ts";

const viewerPayload = {
	data: { Viewer: { id: 9 } },
};

const listPayload = {
	data: {
		MediaListCollection: {
			lists: [
				{
					entries: [
						{
							media: { id: 11, title: { userPreferred: "One" } },
							progress: 3,
							score: 80,
							status: "CURRENT",
							updatedAt: 1_700_000_000,
						},
						{
							media: { id: 12, title: { userPreferred: "Two" } },
							progress: 0,
							score: 0,
							status: "PLANNING",
							updatedAt: undefined,
						},
						{
							media: { id: 13, title: { userPreferred: "Three" } },
							progress: 5,
							score: 7,
							status: "REPEATING",
							updatedAt: 1_700_000_100,
						},
					],
				},
				{
					entries: [
						{
							media: { id: 11, title: { userPreferred: "One dup" } },
							progress: 3,
							score: 80,
							status: "CURRENT",
							updatedAt: 1_700_000_000,
						},
					],
				},
			],
		},
	},
};

describe("fetchAnilistAnimeList", () => {
	it("resolves the viewer, maps statuses/scores, and dedupes entries", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(Response.json(viewerPayload))
			.mockResolvedValueOnce(Response.json(listPayload));

		const entries = await fetchAnilistAnimeList({
			accessToken: "tok",
			fetchImpl,
		});

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(entries).toEqual([
			{
				externalTitleId: "11",
				progress: 3,
				score: 8,
				status: "watching",
				title: "One",
				updatedAt: new Date(1_700_000_000 * 1000).toISOString(),
			},
			{
				externalTitleId: "12",
				progress: 0,
				score: undefined,
				status: "plan_to_watch",
				title: "Two",
				updatedAt: undefined,
			},
			{
				externalTitleId: "13",
				progress: 5,
				score: 7,
				status: "rewatching",
				title: "Three",
				updatedAt: new Date(1_700_000_100 * 1000).toISOString(),
			},
		]);
	});

	it("throws on non-OK responses", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response("nope", { status: 401 }));
		await expect(
			fetchAnilistAnimeList({
				accessToken: "tok",
				fetchImpl,
			}),
		).rejects.toThrow(/401/u);
	});
});
