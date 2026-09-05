import { describe, expect, it } from "vitest";

import type { ResolveResult } from "@/engine";
import { defaultProviders, fetchDisplayMetadata } from "@/orpc/providers";
import type { Providers, WorkMetadata } from "@/orpc/providers";

const anime: ResolveResult = {
	continuityId: "continuity:1",
	mediaKind: "anime",
	segments: [
		{
			instalments: ["anidb:1#1"],
			kind: "episodic",
			members: { anidb: "1", tmdb: "tv:10" },
		},
	],
};

const film: ResolveResult = {
	continuityId: "continuity:2",
	mediaKind: "film",
	segments: [
		{
			instalments: ["tmdb:movie:1#1"],
			kind: "atomic",
			members: { tmdb: "movie:1" },
		},
	],
};

const metadata = (genres: readonly string[]): WorkMetadata => ({
	backdropRef: undefined,
	cast: [],
	coverRef: undefined,
	genres,
	ifYouLiked: [],
	nativeTitle: undefined,
	productionStatus: undefined,
	runtimeMinutes: 24,
	segments: [],
	span: "",
	staff: [],
	studios: [],
	synopsis: "",
	title: "X",
});

const providersFor = (
	anidb: WorkMetadata,
	tmdb: WorkMetadata | Error,
): Providers => ({
	...defaultProviders,
	metadata: {
		...defaultProviders.metadata,
		anidb: {
			fetchWork: async () => {
				const work = await Promise.resolve(anidb);
				return work;
			},
		},
		tmdb: {
			fetchWork: async () => {
				if (tmdb instanceof Error) {
					throw tmdb;
				}
				const work = await Promise.resolve(tmdb);
				return work;
			},
		},
	},
});

describe("fetchDisplayMetadata", () => {
	it("keeps anime genres from anidb when they are present", async () => {
		const meta = await fetchDisplayMetadata(
			providersFor(metadata(["Comedy"]), metadata(["Drama"])),
			anime,
		);
		expect(meta.genres).toEqual(["Comedy"]);
		expect(meta.runtimeMinutes).toBe(24);
	});

	it("overlays tmdb genres when anidb has none", async () => {
		const meta = await fetchDisplayMetadata(
			providersFor(metadata([]), metadata(["Comedy", "Action"])),
			anime,
		);
		expect(meta.genres).toEqual(["Comedy", "Action"]);
		expect(meta.runtimeMinutes).toBe(24);
	});

	it("keeps anidb genres when tmdb fails", async () => {
		const meta = await fetchDisplayMetadata(
			providersFor(metadata(["Comedy"]), new Error("tmdb down")),
			anime,
		);
		expect(meta.genres).toEqual(["Comedy"]);
		expect(meta.runtimeMinutes).toBe(24);
	});

	it("drops anime genres when anidb has none and tmdb fails", async () => {
		const meta = await fetchDisplayMetadata(
			providersFor(metadata([]), new Error("tmdb down")),
			anime,
		);
		expect(meta.genres).toEqual([]);
		expect(meta.runtimeMinutes).toBe(24);
	});

	it("leaves film genres on the tmdb snapshot", async () => {
		const tmdb = metadata(["Science Fiction"]);
		const meta = await fetchDisplayMetadata(
			providersFor(metadata(["AniDB Tag"]), tmdb),
			film,
		);
		expect(meta.genres).toEqual(["Science Fiction"]);
	});
});
