import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePartSelectionStore } from "@/components/work/part-state";
import type {
	EpisodeView,
	FilmView,
	PartView,
	RateableUnit,
} from "@/orpc/schema";

import { EpisodeList } from "./episode-list";
import { Episodes } from "./episodes";
import { FilmRow } from "./film-row";

const { capturedScores, setRating, useSession } = vi.hoisted(() => {
	const handlers: ((score: number | undefined) => void)[] = [];
	return {
		capturedScores: handlers,
		setRating: vi.fn<(unit: RateableUnit, score: number | undefined) => void>(),
		useSession: vi.fn(),
	};
});

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		useSession,
	},
}));

const noopClose = () => {
	/* empty */
};

const UNRATED_LABEL = "–";

vi.mock("react-aria-components", async () => {
	const { createElement } = await import("react");
	const passthrough = (tag: string) => {
		function Component({
			children,
			...rest
		}: {
			children?: ReactNode;
		} & Record<string, unknown>) {
			return createElement(tag, rest, children);
		}
		return Component;
	};
	return {
		Button: passthrough("button"),
		Dialog: ({
			children,
		}: {
			children?: ReactNode | ((opts: { close: () => void }) => ReactNode);
		}) => {
			const content =
				typeof children === "function"
					? children({ close: noopClose })
					: children;
			return createElement("div", { role: "dialog" }, content);
		},
		DialogTrigger: ({
			children,
			isOpen,
		}: {
			children?: ReactNode;
			isOpen?: boolean;
		}) =>
			createElement(
				"div",
				{ "data-dialog-open": String(isOpen === true) },
				children,
			),
		Form: passthrough("form"),
		Heading: passthrough("h2"),
		Input: passthrough("input"),
		Label: passthrough("label"),
		Modal: passthrough("div"),
		ModalOverlay: ({
			children,
			...rest
		}: {
			children?: ReactNode;
		} & Record<string, unknown>) => createElement("div", rest, children),
		TextField: passthrough("div"),
	};
});

vi.mock("@/components/work/sidebar/score-select", () => ({
	ScoreSelect: ({
		label,
		onChange,
		value,
	}: {
		label: string;
		onChange: (score: number | undefined) => void;
		value: number | undefined;
	}) => {
		capturedScores.push(onChange);
		return (
			<select aria-label={label} value={value ?? ""}>
				<option value="">{UNRATED_LABEL}</option>
			</select>
		);
	},
}));

vi.mock("@/components/work/sidebar/use-work-tracking", () => ({
	useWorkTracking: () => ({
		setRating,
		setRewatch: vi.fn(),
		setStatus: vi.fn(),
	}),
}));

const emptyScore = { count: 0, mean: undefined };

const idleSession = {
	data: undefined,
	error: undefined,
	isPending: false,
	isRefetching: false,
	refetch: noopClose,
};

const signedIn = {
	...idleSession,
	data: {
		session: { id: "s1", userId: "u1" },
		user: { email: "ada@example.com", id: "u1", name: "Ada" },
	},
};

const episode = (locator: string, title: string): EpisodeView => ({
	airDate: "2022-04-09",
	communityScore: emptyScore,
	instalmentLocator: locator,
	number: 1,
	personalRating: undefined,
	rateableUnit: { key: locator, kind: "episode" },
	title,
	watched: false,
});

const partOne: PartView = {
	airedFrom: undefined,
	airedTo: undefined,
	communityScore: emptyScore,
	episodeCount: 1,
	episodes: [episode("anidb:1#1", "Operation Strix")],
	kind: "part",
	label: "Part 1",
	personalRating: undefined,
	rateableUnit: { key: "part:Part 1", kind: "part" },
	serviceRatings: [],
	year: 2022,
};

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

const partOnly = [partOne];
const noopToggle =
	vi.fn<(instalmentLocator: string, watched: boolean) => void>();

describe("episode and film rating wiring", () => {
	afterEach(() => {
		capturedScores.length = 0;
		setRating.mockReset();
		useSession.mockReset();
		usePartSelectionStore.setState({ selectedKey: undefined });
	});

	it("invokes onRate with the episode rateable unit", () => {
		const onRate =
			vi.fn<(unit: RateableUnit, score: number | undefined) => void>();
		renderToStaticMarkup(
			<EpisodeList
				episodes={partOne.episodes}
				onRate={onRate}
				onToggle={noopToggle}
			/>,
		);
		expect(capturedScores).toHaveLength(1);
		capturedScores[0]?.(7);
		capturedScores[0]?.(undefined);
		expect(onRate).toHaveBeenNthCalledWith(
			1,
			{ key: "anidb:1#1", kind: "episode" },
			7,
		);
		expect(onRate).toHaveBeenNthCalledWith(
			2,
			{ key: "anidb:1#1", kind: "episode" },
			undefined,
		);
	});

	it("invokes onRate with the film movie unit", () => {
		const onRate =
			vi.fn<(unit: RateableUnit, score: number | undefined) => void>();
		renderToStaticMarkup(
			<FilmRow film={dawn} onRate={onRate} onToggle={noopToggle} />,
		);
		expect(capturedScores).toHaveLength(1);
		capturedScores[0]?.(8);
		expect(onRate).toHaveBeenCalledWith(
			{ key: "anidb:film#1", kind: "movie" },
			8,
		);
	});

	it("routes episode ScoreSelect through setRating when signed in", () => {
		useSession.mockReturnValue(signedIn);
		usePartSelectionStore.getState().selectKey(partOne.rateableUnit.key);
		renderToStaticMarkup(
			<QueryClientProvider client={new QueryClient()}>
				<Episodes continuityId="continuity:x" parts={partOnly} />
			</QueryClientProvider>,
		);
		expect(capturedScores.length).toBeGreaterThan(0);
		capturedScores[0]?.(9);
		expect(setRating).toHaveBeenCalledWith(
			{ key: "anidb:1#1", kind: "episode" },
			9,
		);
	});
});
