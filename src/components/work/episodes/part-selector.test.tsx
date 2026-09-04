import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { EpisodeView, FilmView, PartView, WorkBlock } from "@/orpc/schema";

import { CLEAR_PART, MARK_PART, PartSelector } from "./part-selector";

const emptyScore = { count: 0, mean: undefined };
const noopMark = vi.fn<(locators: string[], watched: boolean) => void>();
const noopSelect = vi.fn<(index: number) => void>();

const episode = (watched: boolean, index = 1): EpisodeView => ({
	airDate: "2022-04-09",
	communityScore: emptyScore,
	instalmentLocator: `ep:${String(index)}`,
	number: index,
	personalRating: undefined,
	rateableUnit: { key: `episode:${String(index)}`, kind: "episode" },
	title: "Operation Strix",
	watched,
});

const part = (watched: boolean, index = 1): PartView => ({
	airedFrom: undefined,
	airedTo: undefined,
	communityScore: emptyScore,
	episodeCount: 1,
	episodes: [episode(watched, index)],
	kind: "part",
	label: `Part ${String(index)}`,
	personalRating: undefined,
	rateableUnit: { key: `part:${String(index)}`, kind: "part" },
	serviceRatings: [],
	year: 2022,
});

const film = (watched: boolean): FilmView => ({
	airDate: "2020-01-17",
	airedFrom: "2020-01-17",
	airedTo: "2020-01-17",
	communityScore: emptyScore,
	episodeCount: 0,
	episodes: [],
	instalmentLocator: "anidb:film#1",
	kind: "film",
	label: "Dawn of the Deep Soul",
	personalRating: undefined,
	rateableUnit: { key: "anidb:film#1", kind: "movie" },
	serviceRatings: [],
	watched,
	year: 2020,
});

const renderSelector = (
	parts: WorkBlock[],
	watchedCount: number,
	episodeCount: number,
	selectedIndex = 0,
) =>
	renderToStaticMarkup(
		<PartSelector
			episodeCount={episodeCount}
			onMarkPart={noopMark}
			onSelect={noopSelect}
			parts={parts}
			selectedIndex={selectedIndex}
			watchedCount={watchedCount}
		/>,
	);

describe("PartSelector mark control", () => {
	it("shows mark part watched when the selected part is incomplete", () => {
		const html = renderSelector([part(false)], 0, 1);
		expect(html).toContain(MARK_PART);
		expect(html).not.toContain(CLEAR_PART);
	});

	it("shows clear part watched when every instalment is watched", () => {
		const html = renderSelector([part(true)], 1, 1);
		expect(html).toContain(CLEAR_PART);
		expect(html).not.toContain(MARK_PART);
	});

	it("shows the same copy for a film part", () => {
		expect(renderSelector([film(false)], 0, 1)).toContain(MARK_PART);
		expect(renderSelector([film(true)], 1, 1)).toContain(CLEAR_PART);
	});

	it("uses the selected part, not the rest of the work", () => {
		const parts = [part(true, 1), part(false, 2)];
		expect(renderSelector(parts, 0, 1, 0)).toContain(CLEAR_PART);
		expect(renderSelector(parts, 0, 1, 1)).toContain(MARK_PART);
	});

	it("marks from listed locators when episodeCount disagrees", () => {
		const listed = { ...part(true), episodeCount: 12 };
		expect(renderSelector([listed], 1, 12)).toContain(CLEAR_PART);
		expect(renderSelector([listed], 1, 12)).not.toContain(MARK_PART);
	});
});
