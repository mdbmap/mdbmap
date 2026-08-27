import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePartSelectionStore } from "@/components/work/part-state";
import type { PartView, ServiceRating, ViewerTracking } from "@/orpc/schema";

import { PartDetails, PartPanel } from "./part-panel";
import { YouBlock } from "./you-block";

const NO_PARTS: PartView[] = [];
const noRate = vi.fn<(score: number | undefined) => void>();

const service = (
	name: string,
	score: number,
	scale: number,
	votes: number,
): ServiceRating => ({
	scale,
	score,
	service: name,
	votes,
});

const part = (label: string, overrides: Partial<PartView> = {}): PartView => ({
	airedFrom: undefined,
	airedTo: undefined,
	communityScore: { count: 0, mean: undefined },
	episodeCount: 12,
	episodes: [],
	kind: "part",
	label,
	personalRating: undefined,
	rateableUnit: { key: `part:${label}`, kind: "part" },
	serviceRatings: [],
	year: 2022,
	...overrides,
});

const partOne = part("Part 1", {
	communityScore: { count: 210_000, mean: 8.11 },
	serviceRatings: [service("anidb", 8.2, 10, 5100)],
});
const seasonTwo = part("Season 2", {
	airedFrom: "Oct 2023",
	airedTo: "Dec 2023",
	communityScore: { count: 120_000, mean: 8.41 },
	episodeCount: 12,
	serviceRatings: [
		service("mal", 8.45, 10, 210_000),
		service("anilist", 83, 100, 150_000),
	],
});
const parts = [partOne, part("Part 2"), seasonTwo];

const viewer: ViewerTracking = {
	personalRating: 8,
	rewatchCount: 2,
	status: "watching",
	watched: Array.from({ length: 25 }, (_item, index) => `ep:${index}`),
};

const render = (node: ReactNode) =>
	renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			{node}
		</QueryClientProvider>,
	);

describe("YouBlock", () => {
	it("shows the whole-series status, score, progress and rewatch count", () => {
		const html = render(
			<YouBlock continuityId="continuity:x" parts={parts} viewer={viewer} />,
		);
		expect(html).toContain("You · whole series");
		expect(html).toContain("watching");
		expect(html).toContain("25 / 36 across 3 parts");
		expect(html).toContain("rewatch ×2");
		// The viewer's work score is the selected option.
		expect(html).toContain('value="8"');
		expect(html).toContain("selected");
	});

	it("falls back to zero progress when the viewer is untracked", () => {
		const html = render(
			<YouBlock continuityId="continuity:x" parts={parts} viewer={undefined} />,
		);
		expect(html).toContain("0 / 36 across 3 parts");
		expect(html).toContain("rewatch ×0");
		expect(html).toContain("set status");
	});
});

describe("PartPanel", () => {
	afterEach(() => {
		usePartSelectionStore.setState({ selectedKey: undefined });
	});

	it("renders the selected part's three rating layers as separate values", () => {
		const html = render(
			<PartPanel continuityId="continuity:x" parts={parts} />,
		);
		// Untouched selection resolves to the last part.
		expect(html).toContain("Season 2 · this part");
		expect(html).toContain("mdbmap average");
		expect(html).toContain("8.41");
		expect(html).toContain("120K");
		// Service ratings listed in native scale with vote counts, never merged.
		expect(html).toContain("mal");
		expect(html).toContain("8.45");
		expect(html).toContain("/10");
		expect(html).toContain("anilist");
		expect(html).toContain("/100");
		expect(html).toContain("210K");
		expect(html).toContain("Oct 2023 – Dec 2023");
	});

	// The store's SSR snapshot is always its initial (untouched) state, so a
	// selection change can't be driven through renderToStaticMarkup. The panel's
	// content is proven to follow whichever part it is handed via PartDetails; the
	// selection wiring itself is covered by part-state's resolveSelectedIndex.
	it("renders the facts of whichever part it is given", () => {
		const html = render(<PartDetails onRate={noRate} part={partOne} />);
		expect(html).toContain("Part 1 · this part");
		expect(html).toContain("8.11");
		expect(html).toContain("anidb");
		expect(html).not.toContain("Season 2 · this part");
	});

	it("shows a placeholder when there are no parts", () => {
		const html = render(
			<PartPanel continuityId="continuity:x" parts={NO_PARTS} />,
		);
		expect(html).toContain("No parts");
	});
});
