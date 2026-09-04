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

import { Episodes } from "./episodes";
import { MARK_PART } from "./part-selector";

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
	proposalSegments: readonly { id: number; label: string }[] = [],
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
				proposalSegments={proposalSegments}
			/>
		</QueryClientProvider>,
	);

const resetFilmSelection = () => {
	usePartSelectionStore.setState({ selectedKey: undefined });
	useSession.mockReset();
};

describe("Episodes film rows", () => {
	afterEach(resetFilmSelection);

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
		expect(html).toContain(MARK_PART);
		expect(html).not.toContain("Operation Strix");
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

describe("Episodes order selector", () => {
	afterEach(resetFilmSelection);

	const renderIdleOrdered = (...args: Parameters<typeof renderOrdered>) => {
		useSession.mockReturnValue(idleSession);
		return renderOrdered(...args);
	};

	it("shows a release/watch control when both orders exist", () => {
		const html = renderIdleOrdered(bothOrders);
		expect(html).toContain("Release");
		expect(html).toContain("Watch");
		expect(html).not.toContain("Propose order");
	});

	it("hides the order control when only one order exists", () => {
		const html = renderIdleOrdered(releaseOnly);
		expect(html).not.toContain("Release");
		expect(html).not.toContain("Watch");
		expect(html).not.toContain("Propose order");
	});

	it("shows an accepted community order in the selector", () => {
		const html = renderIdleOrdered(
			bothOrders,
			theatricalOrder,
			sampleProposalSegments,
		);
		expect(html).toContain("Theatrical cut");
		expect(html).toContain("Propose order");
	});

	it("does not invent pending community orders in the selector", () => {
		const html = renderIdleOrdered(
			bothOrders,
			theatricalOrder,
			sampleProposalSegments,
		);
		expect(html).not.toContain("Pending draft");
	});
});
