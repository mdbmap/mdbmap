import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { PresentationOrderSlug } from "@/db/engine-schema";
import type { WorkView } from "@/orpc/schema";

import { WorkPage } from "./work-page";

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
}));

vi.mock("@/integrations/better-auth/header-user", () => ({
	BetterAuthHeader: () => false,
}));

const emptyScore = { count: 0, mean: undefined };

const part = (
	label: string,
	year: number,
	episodeCount: number,
): WorkView["parts"][number] => ({
	airedFrom: undefined,
	airedTo: undefined,
	communityScore: emptyScore,
	episodeCount,
	episodes: [],
	kind: "part",
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

const dawn: WorkView["parts"][number] = {
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

const filmWork: WorkView = { ...work, parts: [...work.parts, dawn] };
const bothOrders = ["release", "watch"] as const;
function ignoreOrder(_order: PresentationOrderSlug) {
	return;
}

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

describe("WorkPage film parts", () => {
	const html = renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			<WorkPage
				onSelectOrder={ignoreOrder}
				order="release"
				orders={bothOrders}
				work={filmWork}
			/>
		</QueryClientProvider>,
	);

	it("counts the film in the banner and shows it in the selector", () => {
		expect(html).toContain("3 parts");
		expect(html).toContain("25 ep");
		expect(html).toContain("Dawn of the Deep Soul");
		expect(html).toContain('aria-label="Mark Dawn of the Deep Soul watched"');
	});

	it("shows a release/watch control when both orders exist", () => {
		expect(html).toContain("Release");
		expect(html).toContain("Watch");
	});
});
