import { MutationObserver, QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import type {
	EpisodeWatchedResult,
	EpisodeView,
	WorkView,
} from "@/orpc/schema";

import { applyEpisodeWatched } from "./optimistic.ts";
import { progressCacheEffects } from "./progress-cache.ts";
import { progressMutationScope } from "./progress-mutation-scope.ts";

const QUERY_KEY = ["work", "continuity:x"];
const CONTINUITY_ID = "continuity:x";
const emptyScore = { count: 0, mean: undefined };

interface EpisodeWrite {
	continuityId: string;
	instalmentLocator: string;
	watched: boolean;
}

const episode = (number: number, watched: boolean): EpisodeView => ({
	airDate: undefined,
	communityScore: emptyScore,
	instalmentLocator: `ep:${String(number)}`,
	number,
	personalRating: undefined,
	rateableUnit: { key: `episode:${String(number)}`, kind: "episode" },
	title: `Episode ${String(number)}`,
	watched,
});

const work = (): WorkView => ({
	cast: [],
	catalogues: [],
	communityOrders: [],
	communityScore: emptyScore,
	continuityId: CONTINUITY_ID,
	header: {
		backdropRef: undefined,
		coverRef: undefined,
		genres: [],
		nativeTitle: undefined,
		productionStatus: undefined,
		runtimeMinutes: undefined,
		span: "2022",
		synopsis: "",
		title: "X",
	},
	ifYouLiked: [],
	mediaKind: "anime",
	parts: [
		{
			airedFrom: undefined,
			airedTo: undefined,
			communityScore: emptyScore,
			episodeCount: 2,
			episodes: [episode(1, false), episode(2, false)],
			kind: "part",
			label: "Part 1",
			personalRating: undefined,
			rateableUnit: { key: "part:1", kind: "part" },
			serviceRatings: [],
			year: 2022,
		},
	],
	proposalSegments: [],
	staff: [],
	studios: [],
	viewer: undefined,
});

const hold = () => Promise.withResolvers<true>();

const rowWatched = (cached: WorkView | undefined) => {
	const part = cached?.parts[0];
	if (part?.kind !== "part") {
		return [];
	}
	return part.episodes.map((item) => item.watched);
};

const applyWrite = (cached: WorkView, variables: EpisodeWrite) =>
	applyEpisodeWatched(cached, variables.instalmentLocator, variables.watched);

const writeOf = (locator: string): EpisodeWrite => ({
	continuityId: CONTINUITY_ID,
	instalmentLocator: locator,
	watched: true,
});

const waitRows = async (client: QueryClient, expected: boolean[]) => {
	await vi.waitFor(() => {
		expect(rowWatched(client.getQueryData(QUERY_KEY))).toEqual(expected);
	});
};

const failThenSucceed =
	(
		firstGate: PromiseWithResolvers<true>,
		secondGate: PromiseWithResolvers<true>,
	) =>
	async (variables: EpisodeWrite): Promise<EpisodeWatchedResult> => {
		if (variables.instalmentLocator === "ep:1") {
			await firstGate.promise;
			throw new Error("persist failed");
		}
		await secondGate.promise;
		return { status: "watching", watched: ["ep:2"] };
	};

const observe = (
	client: QueryClient,
	mutationFn: (variables: EpisodeWrite) => Promise<EpisodeWatchedResult>,
) =>
	new MutationObserver<EpisodeWatchedResult, Error, EpisodeWrite>(client, {
		...progressCacheEffects(client, QUERY_KEY, applyWrite),
		mutationFn,
		scope: progressMutationScope(CONTINUITY_ID),
	});

describe("progress cache effects", () => {
	it("keeps a queued optimistic patch when an earlier scoped write fails", async () => {
		const client = new QueryClient({
			defaultOptions: { mutations: { retry: false } },
		});
		client.setQueryData(QUERY_KEY, work());
		const invalidate = vi.spyOn(client, "invalidateQueries");
		const firstGate = hold();
		const secondGate = hold();
		const mutationFn = failThenSucceed(firstGate, secondGate);
		const first = observe(client, mutationFn).mutate(writeOf("ep:1"));
		await waitRows(client, [true, false]);
		const second = observe(client, mutationFn).mutate(writeOf("ep:2"));
		await waitRows(client, [true, true]);
		firstGate.resolve(true);
		await expect(first).rejects.toThrow("persist failed");
		expect(rowWatched(client.getQueryData(QUERY_KEY))).toEqual([false, true]);
		expect(invalidate).not.toHaveBeenCalled();
		secondGate.resolve(true);
		await second;
		expect(rowWatched(client.getQueryData(QUERY_KEY))).toEqual([false, true]);
		expect(invalidate).toHaveBeenCalled();
	});
});
