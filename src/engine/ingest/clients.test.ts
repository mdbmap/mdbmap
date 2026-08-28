import { describe, expect, it, vi } from "vitest";

import {
	createAnidbVerificationClient,
	createTvdbVerificationClient,
} from "./clients.ts";

const anidbXml = `<?xml version="1.0" encoding="UTF-8"?>
<anime id="16947" restricted="false">
	<type>TV Series</type>
	<startdate>2022-04-09</startdate>
	<episodecount>12</episodecount>
	<titles>
		<title xml:lang="x-jat" type="main">Spy x Family</title>
	</titles>
</anime>`;

const urlOf = (input: RequestInfo | URL): string => {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	return input.url;
};

describe("createAnidbVerificationClient", () => {
	it("parses the anime root and maps format to tv", async () => {
		const fetchFn = vi.fn(async (): Promise<Response> => {
			await Promise.resolve();
			return new Response(anidbXml);
		});

		const client = createAnidbVerificationClient({
			client: "mdbmap",
			clientVer: "1",
			fetchFn,
			rateLimiter: { run: async (task) => task() },
		});

		const record = await client.fetchTitle("16947");

		expect(record).toEqual({
			format: "tv",
			instalmentCount: 12,
			releaseDate: "2022-04-09",
			title: "Spy x Family",
		});
		expect(fetchFn).toHaveBeenCalledOnce();
	});
});

describe("createTvdbVerificationClient", () => {
	it("reports tv format and counts official episodes", async () => {
		const fetchFn = vi.fn(
			async (input: RequestInfo | URL): Promise<Response> => {
				await Promise.resolve();
				const href = urlOf(input);
				if (href.endsWith("/login")) {
					return Response.json({ data: { token: "token" } });
				}
				if (href.includes("/episodes/official")) {
					return Response.json({ data: [{ id: 1 }, { id: 2 }], links: {} });
				}
				return Response.json({
					data: {
						firstAired: "2022-04-09",
						name: "Spy x Family",
					},
				});
			},
		);

		const client = createTvdbVerificationClient({
			apiKey: "key",
			fetchFn,
		});

		const record = await client.fetchTitle("42");

		expect(record).toEqual({
			format: "tv",
			instalmentCount: 2,
			releaseDate: "2022-04-09",
			title: "Spy x Family",
		});
	});
});
