import { describe, expect, it, vi } from "vitest";

import { createAnilistTargetClient } from "./anilist.ts";

describe("createAnilistTargetClient", () => {
	it("posts SaveMediaListEntry for mapped writes", async () => {
		const fetchFn = vi.fn(
			async (
				_input: RequestInfo | URL,
				_init?: RequestInit,
			): Promise<Response> => {
				await Promise.resolve();
				return Response.json({ data: { SaveMediaListEntry: { id: 1 } } });
			},
		);
		const client = createAnilistTargetClient({
			credentials: { accessToken: "tok" },
			fetchFn,
		});
		await client.push({
			progress: [{ episode: 3, externalTitleId: "10", watched: true }],
			ratings: [{ externalTitleId: "10", score: 80, unit: "title" }],
			status: [{ externalTitleId: "10", status: "completed" }],
		});
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("rejects when AniList returns GraphQL errors", async () => {
		const client = createAnilistTargetClient({
			credentials: { accessToken: "tok" },
			fetchFn: async (): Promise<Response> => {
				await Promise.resolve();
				return Response.json({ errors: [{ message: "bad" }] });
			},
		});
		await expect(
			client.push({
				progress: [],
				ratings: [],
				status: [{ externalTitleId: "10", status: "current" }],
			}),
		).rejects.toThrow(/GraphQL error/u);
	});

	it("maps planning onto AniList PLANNING", async () => {
		const fetchFn = vi.fn(
			async (
				_input: RequestInfo | URL,
				_init?: RequestInit,
			): Promise<Response> => {
				await Promise.resolve();
				return Response.json({ data: { SaveMediaListEntry: { id: 1 } } });
			},
		);
		const client = createAnilistTargetClient({
			credentials: { accessToken: "tok" },
			fetchFn,
		});
		await client.push({
			progress: [],
			ratings: [],
			status: [{ externalTitleId: "10", status: "planning" }],
		});
		const raw = fetchFn.mock.calls[0]?.[1]?.body;
		if (typeof raw !== "string") {
			throw new TypeError("expected json body");
		}
		expect(JSON.parse(raw)).toMatchObject({
			variables: { mediaId: 10, status: "PLANNING" },
		});
	});
});
