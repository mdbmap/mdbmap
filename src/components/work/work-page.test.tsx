import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { WorkView } from "@/orpc/schema";

import { WorkPage } from "./work-page";

const emptyScore = { count: 0, mean: undefined };

const part = (label: string, year: number, episodeCount: number): WorkView["parts"][number] => ({
	airedFrom: undefined,
	airedTo: undefined,
	communityScore: emptyScore,
	episodeCount,
	episodes: [],
	label,
	personalRating: undefined,
	rateableUnit: { key: `part:${label}`, kind: "part" },
	serviceRatings: [],
	year,
});

const work: WorkView = {
	cast: [{ name: "Takuya Eguchi", ref: undefined, role: "Loid Forger" }],
	continuityId: "continuity:spy-x-family",
	header: {
		backdropRef: "anidb:16947/backdrop",
		coverRef: "anidb:16947/cover",
		nativeTitle: "SPY×FAMILY",
		span: "2022–2023",
		synopsis: "A spy builds a fake family for a mission.",
		title: "Spy × Family",
	},
	ifYouLiked: [],
	mediaKind: "anime",
	parts: [part("Cour 1", 2022, 12), part("Cour 2", 2023, 12)],
	staff: [],
	studios: ["Wit Studio", "CloverWorks"],
	viewer: undefined,
};

describe("WorkPage shell", () => {
	const html = renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			<WorkPage work={work} />
		</QueryClientProvider>,
	);

	it("renders the banner identity from the WorkView", () => {
		expect(html).toContain("Spy × Family");
		expect(html).toContain("SPY×FAMILY");
		expect(html).toContain("ANIME");
		expect(html).toContain("2 parts");
		expect(html).toContain("24 ep");
		expect(html).toContain("2022–2023");
	});

	it("renders the synopsis and both layout columns", () => {
		expect(html).toContain("A spy builds a fake family for a mission.");
		expect(html).toContain("Episodes");
		expect(html).toContain("Cast");
		expect(html).toContain("You");
		expect(html).toContain("this part");
	});
});
