import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
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

const { useSession } = vi.hoisted(() => ({
	useSession: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		useSession,
	},
}));

const noopClose = () => {
	/* empty */
};

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

const emptyScore = { count: 0, mean: undefined };

const idleSession = {
	data: undefined,
	error: undefined,
	isPending: false,
	isRefetching: false,
	refetch: noopClose,
};

const episode = (locator: string, title: string, number = 1): EpisodeView => ({
	airDate: "2022-04-09",
	communityScore: emptyScore,
	instalmentLocator: locator,
	number,
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
const ratedPartOneEpisodes: EpisodeView[] = [
	{ ...episode("Part 1:1", "Operation Strix", 1), personalRating: 8 },
	episode("Part 1:2", "Secure a Wife", 2),
];

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
const noopRate =
	vi.fn<
		(unit: EpisodeView["rateableUnit"], score: number | undefined) => void
	>();
const noopOrder = vi.fn<(order: "release" | "watch") => void>();
const noopProposal = vi.fn<(proposalId: number) => void>();
const bothOrders = ["release", "watch"] as const;
const releaseOnly = ["release"] as const;
const courThenFilm = [partOne, dawn];
const filmThenCour = [dawn, partOne];
const sampleProposalSegments = [
	{ id: 1, label: "Part 1" },
	{ id: 2, label: "Dawn of the Deep Soul" },
] as const;
const theatricalOrder = [{ id: 11, name: "Theatrical cut" }] as const;

const renderEpisodes = (blocks: WorkBlock[] = parts) =>
	renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			<Episodes continuityId="continuity:x" parts={blocks} />
		</QueryClientProvider>,
	);

const renderOrdered = (
	orders: readonly PresentationOrderSlug[],
	communityOrders: readonly { id: number; name: string }[] = [],
) =>
	renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			<Episodes
				communityOrders={communityOrders}
				continuityId="continuity:x"
				onSelectOrder={noopOrder}
				onSelectProposal={noopProposal}
				order="release"
				orders={orders}
				parts={courThenFilm}
				proposalSegments={sampleProposalSegments}
			/>
		</QueryClientProvider>,
	);

describe("Episodes", () => {
	afterEach(() => {
		usePartSelectionStore.setState({ selectedKey: undefined });
		useSession.mockReset();
	});

	it("shows the selected part's episode list with a watched control", () => {
		useSession.mockReturnValue({
			...idleSession,
			data: {
				session: { id: "s1", userId: "u1" },
				user: { email: "ada@example.com", id: "u1", name: "Ada" },
			},
		});
		const html = renderEpisodes();
		// An untouched selection resolves to the last part (newest cour).
		expect(html).toContain("The Counterespionage");
		expect(html).not.toContain("Operation Strix");
		expect(html).toContain('type="checkbox"');
		expect(html).toContain("0 of 1 watched");
	});

	it("resolves a chosen part index to that part's episodes", () => {
		usePartSelectionStore.getState().selectKey(partOne.rateableUnit.key);
		const index = resolveSelectedIndex(
			usePartSelectionStore.getState().selectedKey,
			parts,
		);
		expect(index).toBe(0);
		const html = renderToStaticMarkup(
			<EpisodeList
				episodes={partOne.episodes}
				onRate={noopRate}
				onToggle={noop}
			/>,
		);
		expect(html).toContain("Operation Strix");
		expect(html).not.toContain("The Counterespionage");
	});

	it("renders a score select reflecting each episode rating", () => {
		const html = renderToStaticMarkup(
			<EpisodeList
				episodes={ratedPartOneEpisodes}
				onRate={noopRate}
				onToggle={noop}
			/>,
		);
		expect(html).toMatch(
			/aria-label="Your score for episode 01"[^>]*>[\s\S]*?<option value="8" selected="">/u,
		);
		expect(html).toMatch(
			/aria-label="Your score for episode 02"[^>]*>[\s\S]*?<option value="" selected="">/u,
		);
	});

	it("embeds a sign-in dialog for signed-out episode watched toggles", () => {
		useSession.mockReturnValue(idleSession);
		const html = renderEpisodes();
		expect(html).toContain("data-auth-dialog");
		expect(html).toContain("Sign in");
	});

	it("does not embed a sign-in dialog while the session is pending", () => {
		useSession.mockReturnValue({
			...idleSession,
			isPending: true,
		});
		const html = renderEpisodes();
		expect(html).not.toContain("data-auth-dialog");
	});
});

describe("Episodes films", () => {
	afterEach(() => {
		usePartSelectionStore.setState({ selectedKey: undefined });
		useSession.mockReset();
	});

	it("shows a film in the selector and a watched control on its row", () => {
		useSession.mockReturnValue({
			...idleSession,
			data: {
				session: { id: "s1", userId: "u1" },
				user: { email: "ada@example.com", id: "u1", name: "Ada" },
			},
		});
		const html = renderEpisodes(courThenFilm);
		expect(html).toContain("Part 1");
		expect(html).toContain("Dawn of the Deep Soul");
		expect(html).toContain('aria-label="Mark Dawn of the Deep Soul watched"');
		expect(html).toContain('aria-label="Your score for Dawn of the Deep Soul"');
		expect(html).toContain("0 of 1 watched");
		expect(html).not.toContain("Operation Strix");
	});

	it("shows a release/watch control when both orders exist", () => {
		useSession.mockReturnValue(idleSession);
		const html = renderOrdered(bothOrders);
		expect(html).toContain("Release");
		expect(html).toContain("Watch");
	});

	it("hides the order control when only one order exists", () => {
		useSession.mockReturnValue(idleSession);
		const html = renderOrdered(releaseOnly);
		expect(html).not.toContain("Release");
		expect(html).not.toContain("Watch");
	});

	it("shows an accepted community order in the selector", () => {
		useSession.mockReturnValue(idleSession);
		const html = renderOrdered(bothOrders, theatricalOrder);
		expect(html).toContain("Theatrical cut");
		expect(html).toContain("Propose order");
	});

	it("does not invent pending community orders in the selector", () => {
		useSession.mockReturnValue(idleSession);
		const html = renderOrdered(bothOrders, theatricalOrder);
		expect(html).not.toContain("Pending draft");
	});

	it("keeps film and part labels when watch order puts the film first", () => {
		useSession.mockReturnValue({
			...idleSession,
			data: {
				session: { id: "s1", userId: "u1" },
				user: { email: "ada@example.com", id: "u1", name: "Ada" },
			},
		});
		const html = renderEpisodes(filmThenCour);
		expect(html).toContain("Dawn of the Deep Soul");
		expect(html).toContain("Part 1");
		expect(html).toContain("Operation Strix");
		expect(html).toContain('aria-label="Mark episode 01 watched"');
	});

	it("keeps the selected part when block order changes", () => {
		usePartSelectionStore.getState().selectKey(partOne.rateableUnit.key);
		expect(
			resolveSelectedIndex(
				usePartSelectionStore.getState().selectedKey,
				courThenFilm,
			),
		).toBe(0);
		expect(
			resolveSelectedIndex(
				usePartSelectionStore.getState().selectedKey,
				filmThenCour,
			),
		).toBe(1);
	});
});
