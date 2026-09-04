import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

import { usePartSelectionStore } from "@/components/work/part-state";
import type {
	CommunityScore,
	PartView,
	ServiceRating,
	ViewerTracking,
} from "@/orpc/schema";

import { CommunityBlock } from "./community-block";
import { PartDetails, PartPanel } from "./part-panel";
import { YouBlock } from "./you-block";

const { useSession } = vi.hoisted(() => ({
	useSession: vi.fn(),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		useSession,
	},
}));

const noop = () => {
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
				typeof children === "function" ? children({ close: noop }) : children;
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

const NO_PARTS: PartView[] = [];
const noRate = vi.fn<(score: number | undefined) => void>();
const emptyCommunity: CommunityScore = { count: 0, mean: undefined };
const populatedCommunity: CommunityScore = { count: 48_000, mean: 8.6 };

const service = (
	name: string,
	score: number,
	scale: number,
	votes: number,
): ServiceRating => ({
	kind: "user",
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

const idleSession = {
	data: undefined,
	error: undefined,
	isPending: false,
	isRefetching: false,
	refetch: noop,
};

const render = (node: ReactNode) =>
	renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			{node}
		</QueryClientProvider>,
	);

describe("YouBlock", () => {
	afterEach(() => {
		useSession.mockReset();
	});

	it("shows the whole-series status, score, progress and rewatch count", () => {
		useSession.mockReturnValue({
			...idleSession,
			data: {
				session: { id: "s1", userId: "u1" },
				user: { email: "ada@example.com", id: "u1", name: "Ada" },
			},
		});
		const html = render(
			<YouBlock continuityId="continuity:x" parts={parts} viewer={viewer} />,
		);
		expect(html).toContain("You · whole series");
		expect(html).toContain("watching");
		expect(html).toContain("25 / 36 across 3 parts");
		expect(html).toContain("rewatch ×2");
		expect(html).toContain('value="8"');
		expect(html).toContain("selected");
		expect(html).not.toContain("data-auth-dialog");
		expect(html).not.toContain("mdbmap average");
		expect(html).not.toContain("mdbmap · whole series");
	});

	it("falls back to zero progress when the viewer is untracked", () => {
		useSession.mockReturnValue({
			...idleSession,
			data: {
				session: { id: "s1", userId: "u1" },
				user: { email: "ada@example.com", id: "u1", name: "Ada" },
			},
		});
		const html = render(
			<YouBlock continuityId="continuity:x" parts={parts} viewer={undefined} />,
		);
		expect(html).toContain("0 / 36 across 3 parts");
		expect(html).toContain("rewatch ×0");
		expect(html).toContain("set status");
	});

	it("embeds a sign-in dialog for signed-out tracking mutations", () => {
		useSession.mockReturnValue(idleSession);
		const html = render(
			<YouBlock continuityId="continuity:x" parts={parts} viewer={undefined} />,
		);
		expect(html).toContain("data-auth-dialog");
		expect(html).toContain('data-dialog-open="false"');
		expect(html).toContain("Sign in");
	});

	it("does not embed a sign-in dialog while the session is pending", () => {
		useSession.mockReturnValue({
			...idleSession,
			isPending: true,
		});
		const html = render(
			<YouBlock continuityId="continuity:x" parts={parts} viewer={undefined} />,
		);
		expect(html).not.toContain("data-auth-dialog");
	});
});

describe("CommunityBlock", () => {
	it("shows an empty community mean and count 0 when nobody has rated", () => {
		const html = render(<CommunityBlock score={emptyCommunity} />);
		expect(html).toContain("mdbmap · whole series");
		expect(html).toContain("mdbmap average");
		expect(html).toContain("—");
		expect(html).toContain('data-votes="0"');
		expect(html).not.toContain("You · whole series");
	});

	it("shows the work-level community mean and count", () => {
		const html = render(<CommunityBlock score={populatedCommunity} />);
		expect(html).toContain("mdbmap · whole series");
		expect(html).toContain("mdbmap average");
		expect(html).toContain("8.6");
		expect(html).toContain("48K");
		expect(html).toContain('data-votes="48000"');
		expect(html).not.toContain("You · whole series");
		expect(html).not.toContain("mal");
	});
});

describe("PartPanel", () => {
	afterEach(() => {
		usePartSelectionStore.setState({ selectedKey: undefined });
		useSession.mockReset();
	});

	it("renders the selected part's three rating layers as separate values", () => {
		useSession.mockReturnValue({
			...idleSession,
			data: {
				session: { id: "s1", userId: "u1" },
				user: { email: "ada@example.com", id: "u1", name: "Ada" },
			},
		});
		const html = render(
			<PartPanel continuityId="continuity:x" parts={parts} />,
		);
		expect(html).toContain("Season 2 · this part");
		expect(html).toContain("mdbmap average");
		expect(html).toContain("8.41");
		expect(html).toContain("120K");
		expect(html).toContain("mal");
		expect(html).toContain("8.45");
		expect(html).toContain("/10");
		expect(html).toContain("anilist");
		expect(html).toContain("/100");
		expect(html).toContain("210K");
		expect(html).toContain("Oct 2023 – Dec 2023");
	});

	it("renders the facts of whichever part it is given", () => {
		const html = render(<PartDetails onRate={noRate} part={partOne} />);
		expect(html).toContain("Part 1 · this part");
		expect(html).toContain("8.11");
		expect(html).toContain("anidb");
		expect(html).not.toContain("Season 2 · this part");
	});

	it("renders a part score select for the given part", () => {
		const html = render(<PartDetails onRate={noRate} part={partOne} />);
		expect(html).toContain('aria-label="Your score for Part 1"');
	});

	it("shows a placeholder when there are no parts", () => {
		useSession.mockReturnValue(idleSession);
		const html = render(
			<PartPanel continuityId="continuity:x" parts={NO_PARTS} />,
		);
		expect(html).toContain("No parts");
	});

	it("embeds a sign-in dialog for signed-out part rating", () => {
		useSession.mockReturnValue(idleSession);
		const html = render(
			<PartPanel continuityId="continuity:x" parts={parts} />,
		);
		expect(html).toContain("data-auth-dialog");
		expect(html).toContain("Sign in");
	});

	it("does not embed a sign-in dialog while the session is pending", () => {
		useSession.mockReturnValue({
			...idleSession,
			isPending: true,
		});
		const html = render(
			<PartPanel continuityId="continuity:x" parts={parts} />,
		);
		expect(html).not.toContain("data-auth-dialog");
	});
});
