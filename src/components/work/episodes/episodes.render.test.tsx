import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveSelectedIndex, usePartSelectionStore } from "@/components/work/part-state";
import type { EpisodeView, PartView } from "@/orpc/schema";

import { EpisodeList } from "./episode-list";
import { Episodes } from "./episodes";

const emptyScore = { count: 0, mean: undefined };

const episode = (locator: string, title: string): EpisodeView => ({
	airDate: "2022-04-09",
	communityScore: emptyScore,
	instalmentLocator: locator,
	number: 1,
	personalRating: undefined,
	rateableUnit: { key: `episode:${locator}`, kind: "episode" },
	title,
	watched: false,
});

const part = (label: string, title: string): PartView => ({
	airedFrom: undefined,
	airedTo: undefined,
	communityScore: emptyScore,
	episodeCount: 1,
	episodes: [episode(`${label}:1`, title)],
	label,
	personalRating: undefined,
	rateableUnit: { key: `part:${label}`, kind: "part" },
	serviceRatings: [],
	year: 2022,
});

const partOne = part("Part 1", "Operation Strix");
const partTwo = part("Part 2", "The Counterespionage");
const parts = [partOne, partTwo];

const noop = vi.fn<(instalmentLocator: string, watched: boolean) => void>();

const renderEpisodes = () =>
	renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			<Episodes continuityId="continuity:x" parts={parts} />
		</QueryClientProvider>,
	);

describe("Episodes", () => {
	afterEach(() => {
		usePartSelectionStore.setState({ selectedIndex: undefined });
	});

	it("shows the selected part's episode list with a watched control", () => {
		const html = renderEpisodes();
		// An untouched selection resolves to the last part (newest cour).
		expect(html).toContain("The Counterespionage");
		expect(html).not.toContain("Operation Strix");
		expect(html).toContain('type="checkbox"');
		expect(html).toContain("0 of 1 watched");
	});

	it("resolves a chosen part index to that part's episodes", () => {
		usePartSelectionStore.getState().selectPart(0);
		const index = resolveSelectedIndex(
			usePartSelectionStore.getState().selectedIndex,
			parts.length,
		);
		expect(index).toBe(0);
		const html = renderToStaticMarkup(
			<EpisodeList episodes={partOne.episodes} onToggle={noop} />,
		);
		expect(html).toContain("Operation Strix");
		expect(html).not.toContain("The Counterespionage");
	});
});
