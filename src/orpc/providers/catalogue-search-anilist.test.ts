import { describe, expect, it, vi } from "vitest";

import { createAnilistCatalogueSearch } from "./catalogue-search-anilist.ts";

const searchBodyWithNullMedia = `{
  "data": {
    "Page": {
      "media": [
        null,
        {
          "id": 21,
          "seasonYear": 1999,
          "title": { "english": "One Piece", "romaji": "One Piece" },
          "coverImage": { "large": "https://img.example/a.jpg" }
        }
      ]
    }
  }
}`;

describe("anilist catalogue search", () => {
	it("keeps valid hits when Page.media includes null entries", async () => {
		const fetchFn = vi.fn(async (): Promise<Response> => {
			await Promise.resolve();
			return new Response(searchBodyWithNullMedia, {
				headers: { "Content-Type": "application/json" },
			});
		});
		const search = createAnilistCatalogueSearch({ fetchFn });

		await expect(search.search("one")).resolves.toEqual([
			{
				catalogue: { id: "21", service: "anilist" },
				coverRef: "https://img.example/a.jpg",
				mediaKind: "anime",
				title: "One Piece",
				year: 1999,
			},
		]);
	});
});
