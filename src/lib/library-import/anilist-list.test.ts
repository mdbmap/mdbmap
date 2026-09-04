import { describe, expect, it, vi } from "vitest";

import { fetchAnilistAnimeList } from "./anilist-list.ts";

const ok = (body: unknown) => Response.json(body);

const viewer = (scoreFormat: string) =>
	ok({ data: { Viewer: { id: 9, mediaListOptions: { scoreFormat } } } });

const row = (
	id: number,
	title: string,
	progress: number,
	score: number,
	status: string,
	updatedAt?: number,
) => ({
	media: { id, title: { userPreferred: title } },
	progress,
	score,
	status,
	updatedAt,
});

describe("fetchAnilistAnimeList", () => {
	it("maps rows, skips custom lists, and dedupes", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(viewer("POINT_100"))
			.mockResolvedValueOnce(
				ok({
					data: {
						MediaListCollection: {
							lists: [
								{
									entries: [
										row(11, "One", 3, 80, "CURRENT", 1_700_000_000),
										row(12, "Two", 0, 0, "PLANNING"),
									],
									isCustomList: false,
								},
								{
									entries: [
										row(11, "One dup", 3, 80, "CURRENT", 1_700_000_000),
									],
									isCustomList: false,
								},
								{
									entries: [row(99, "Custom", 1, 40, "CURRENT", 1)],
									isCustomList: true,
								},
							],
						},
					},
				}),
			);
		const entries = await fetchAnilistAnimeList({
			accessToken: "tok",
			fetchImpl,
		});
		expect(entries.map((item) => item.externalTitleId)).toEqual(["11", "12"]);
		expect(entries[0]).toMatchObject({ score: 8, status: "watching" });
	});

	it("scales POINT_5 scores onto the shared 1–10 range", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(viewer("POINT_5"))
			.mockResolvedValueOnce(
				ok({
					data: {
						MediaListCollection: {
							lists: [
								{
									entries: [row(1, "Five", 1, 4, "COMPLETED", 1)],
									isCustomList: false,
								},
							],
						},
					},
				}),
			);
		const entries = await fetchAnilistAnimeList({
			accessToken: "tok",
			fetchImpl,
		});
		expect(entries[0]?.score).toBe(8);
	});

	it("clamps low POINT_100 scores to 1", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValueOnce(viewer("POINT_100"))
			.mockResolvedValueOnce(
				ok({
					data: {
						MediaListCollection: {
							lists: [
								{
									entries: [row(1, "Low", 1, 3, "COMPLETED", 1)],
									isCustomList: false,
								},
							],
						},
					},
				}),
			);
		const entries = await fetchAnilistAnimeList({
			accessToken: "tok",
			fetchImpl,
		});
		expect(entries[0]?.score).toBe(1);
	});

	it("throws on non-OK responses", async () => {
		const fetchImpl = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response("nope", { status: 401 }));
		await expect(
			fetchAnilistAnimeList({ accessToken: "tok", fetchImpl }),
		).rejects.toThrow(/401/u);
	});
});
