import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
	resolveSelectedIndex,
	usePartSelectionStore,
} from "@/components/work/part-state";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import type { EpisodeView, FilmView, PartView, WorkBlock } from "@/orpc/schema";

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
	kind: "part",
	label,
	personalRating: undefined,
	rateableUnit: { key: `part:${label}`, kind: "part" },
	serviceRatings: [],
	year: 2022,
});

const partOne = part("Part 1", "Operation Strix");
const partTwo = part("Part 2", "The Counterespionage");
const parts = [partOne, partTwo];

const dawn: FilmView = {
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
	watched: false,
	year: 2020,
};

const noop = vi.fn<(instalmentLocator: string, watched: boolean) => void>();
const noopOrder = vi.fn<(order: "release" | "watch") => void>();
const bothOrders = ["release", "watch"] as const;
const releaseOnly = ["release"] as const;
const courThenFilm = [partOne, dawn];
const filmThenCour = [dawn, partOne];

const renderEpisodes = (blocks: WorkBlock[] = parts) =>
	renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			<Episodes continuityId="continuity:x" parts={blocks} />
		</QueryClientProvider>,
	);

const renderOrdered = (orders: readonly PresentationOrderSlug[]) =>
	renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			<Episodes
				continuityId="continuity:x"
				onSelectOrder={noopOrder}
				order="release"
				orders={orders}
				parts={courThenFilm}
			/>
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

describe("Episodes films", () => {
	afterEach(() => {
		usePartSelectionStore.setState({ selectedIndex: undefined });
	});

	it("shows a film in the selector and a watched control on its row", () => {
		const html = renderEpisodes(courThenFilm);
		expect(html).toContain("Part 1");
		expect(html).toContain("Dawn of the Deep Soul");
		expect(html).toContain('aria-label="Mark Dawn of the Deep Soul watched"');
		expect(html).toContain("0 of 1 watched");
		expect(html).not.toContain("Operation Strix");
	});

	it("shows a release/watch control when both orders exist", () => {
		const html = renderOrdered(bothOrders);
		expect(html).toContain("Release");
		expect(html).toContain("Watch");
	});

	it("hides the order control when only one order exists", () => {
		const html = renderOrdered(releaseOnly);
		expect(html).not.toContain("Release");
		expect(html).not.toContain("Watch");
	});

	it("keeps film and part labels when watch order puts the film first", () => {
		const html = renderEpisodes(filmThenCour);
		expect(html).toContain("Dawn of the Deep Soul");
		expect(html).toContain("Part 1");
		expect(html).toContain("Operation Strix");
		expect(html).toContain('aria-label="Mark episode 01 watched"');
	});
});
