import { describe, expect, it, vi } from "vitest";

import { createMalTargetClient } from "./mal.ts";

describe("createMalTargetClient", () => {
	it("puts anime list status for mapped writes", async () => {
		const fetchFn = vi.fn(
			async (
				_input: RequestInfo | URL,
				_init?: RequestInit,
			): Promise<Response> => {
				await Promise.resolve();
				return new Response("{}", { status: 200 });
			},
		);
		const client = createMalTargetClient({
			credentials: { accessToken: "tok" },
			fetchFn,
		});
		await client.push({
			progress: [{ episode: 5, externalTitleId: "20", watched: true }],
			ratings: [{ externalTitleId: "20", score: 9, unit: "title" }],
			status: [{ externalTitleId: "20", status: "repeating" }],
		});
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});

	it("pushes completed status without failing rewatch handling", async () => {
		const fetchFn = vi.fn(
			async (
				_input: RequestInfo | URL,
				_init?: RequestInit,
			): Promise<Response> => {
				await Promise.resolve();
				return new Response("{}", { status: 200 });
			},
		);
		const client = createMalTargetClient({
			credentials: { accessToken: "tok" },
			fetchFn,
		});
		await client.push({
			progress: [],
			ratings: [],
			status: [{ externalTitleId: "20", status: "completed" }],
		});
		expect(fetchFn).toHaveBeenCalledTimes(1);
	});
});
