import { describe, expect, it, vi } from "vitest";

import { fetchMalAnimeList } from "./mal-list.ts";

const page = (rows: unknown[], next?: string) => ({
	data: rows,
	paging: next === undefined ? {} : { next },
});

const row = (
	id: number,
	status: string,
	extra: Record<string, unknown> = {},
) => ({
	list_status: {
		is_rewatching: false,
		num_episodes_watched: 3,
		score: 7,
		status,
		updated_at: "2024-01-02T00:00:00Z",
		...extra,
	},
	node: { id, title: `Title ${String(id)}` },
});

describe("fetchMalAnimeList", () => {
	it("paginates and maps rewatching", async () => {
		const firstPage = page(
			[row(1, "watching")],
			"https://api.myanimelist.net/v2/users/@me/animelist?offset=100",
		);
		const secondPage = page([
			row(2, "completed", { is_rewatching: true, score: 0 }),
		]);
		const fetchImpl = vi
			.fn()
			.mockResolvedValueOnce(Response.json(firstPage))
			.mockResolvedValueOnce(Response.json(secondPage));

		const entries = await fetchMalAnimeList({
			accessToken: "tok",
			fetchImpl,
		});

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(entries).toEqual([
			{
				externalTitleId: "1",
				progress: 3,
				score: 7,
				status: "watching",
				title: "Title 1",
				updatedAt: "2024-01-02T00:00:00Z",
			},
			{
				externalTitleId: "2",
				progress: 3,
				score: undefined,
				status: "rewatching",
				title: "Title 2",
				updatedAt: "2024-01-02T00:00:00Z",
			},
		]);
	});

	it("stops pagination when next repeats a visited URL", async () => {
		const loopUrl =
			"https://api.myanimelist.net/v2/users/@me/animelist?offset=0";
		const firstPage = page([row(1, "watching")], loopUrl);
		const fetchImpl = vi
			.fn()
			.mockImplementation(async () =>
				Promise.resolve(Response.json(firstPage)),
			);

		const entries = await fetchMalAnimeList({
			accessToken: "tok",
			baseUrl: "https://api.myanimelist.net/v2",
			fetchImpl,
		});

		expect(fetchImpl).toHaveBeenCalledTimes(2);
		expect(entries).toHaveLength(2);
	});

	it("stops pagination when next is cross-origin", async () => {
		const firstPage = page([row(1, "watching")], "https://evil.example/steal");
		const fetchImpl = vi.fn().mockResolvedValueOnce(Response.json(firstPage));

		const entries = await fetchMalAnimeList({
			accessToken: "tok",
			fetchImpl,
		});

		expect(fetchImpl).toHaveBeenCalledTimes(1);
		expect(entries).toHaveLength(1);
	});

	it("throws on non-OK responses", async () => {
		const fetchImpl = vi
			.fn()
			.mockResolvedValue(new Response("nope", { status: 401 }));
		await expect(
			fetchMalAnimeList({
				accessToken: "tok",
				fetchImpl,
			}),
		).rejects.toThrow(/401/u);
	});
});
