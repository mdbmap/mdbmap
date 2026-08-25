import { describe, expect, it, vi } from "vitest";

import { createSimklClient } from "./simkl.ts";

const searchJson = [
	{ ids: { anidb: 2, mal: 200, simkl: 555, tmdb: 999 }, title: "Mid", type: "anime" },
];

const entryJson = {
	ids: { mal: 200, simkl: 555 },
	relations: [
		{ ids: { simkl: 777 }, relation_type: "Sequel" },
		{ ids: { simkl: 888 }, relation_type: "Side Story" },
	],
	title: "Mid",
	type: "anime",
};

const urlOf = (input: RequestInfo | URL): string => {
	if (typeof input === "string") {
		return input;
	}
	return input instanceof URL ? input.href : input.url;
};

const makeFetch = (responder: (url: string) => Response) =>
	vi.fn(async (input: RequestInfo | URL): Promise<Response> => {
		await Promise.resolve();
		return responder(urlOf(input));
	});

describe("simkl client", () => {
	it("normalises a search hit into an entry with stringified external ids", async () => {
		const fetchFn = makeFetch(() => Response.json(searchJson));
		const client = createSimklClient({ apiKey: "test-key", fetchFn });

		const entry = await client.findByExternalId("mal", "200");

		expect(entry).toStrictEqual({
			externalIds: { anidb: "2", mal: "200", tmdb: "999" },
			id: "555",
			relations: [],
			title: "Mid",
			type: "anime",
		});
	});

	it("normalises relation kinds and keeps only what the walk reads", async () => {
		const fetchFn = makeFetch(() => Response.json(entryJson));
		const client = createSimklClient({ apiKey: "test-key", fetchFn });

		const entry = await client.fetchEntry("555");

		expect(entry?.relations).toStrictEqual([
			{ kind: "sequel", toId: "777" },
			{ kind: "side_story", toId: "888" },
		]);
	});

	it("answers undefined when SIMKL has no record", async () => {
		const fetchFn = makeFetch(() => Response.json([]));
		const client = createSimklClient({ apiKey: "test-key", fetchFn });

		expect(await client.findByExternalId("mal", "404")).toBeUndefined();
	});

	it("throws on a failed request so the broker can fall through", async () => {
		const fetchFn = makeFetch(() =>
			Response.json({ error: "boom" }, { status: 500 }),
		);
		const client = createSimklClient({ apiKey: "test-key", fetchFn });

		await expect(client.fetchEntry("555")).rejects.toThrow("simkl: 500");
	});
});
