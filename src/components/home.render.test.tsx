import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryEntry } from "@/orpc/schema";

import { Home } from "./home";

const libraryKey = ["library", "list"] as const;

const { useSession } = vi.hoisted(() => ({
	useSession: vi.fn(),
}));

const noop = () => {
	/* empty */
};

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		signIn: { email: vi.fn() },
		signOut: vi.fn(),
		signUp: { email: vi.fn() },
		useSession,
	},
}));

vi.mock("@/orpc/client", () => ({
	orpc: {
		library: {
			list: {
				queryOptions: () => ({
					queryFn: async () => {
						await Promise.resolve();
						return [] as LibraryEntry[];
					},
					queryKey: libraryKey,
				}),
			},
		},
	},
}));

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		params,
		to,
	}: {
		children: ReactNode;
		params?: { continuityId: number | string };
		to: string;
	}) => (
		<a href={to.replace("$continuityId", String(params?.continuityId ?? ""))}>
			{children}
		</a>
	),
}));

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
		ModalOverlay: passthrough("div"),
		TextField: passthrough("div"),
	};
});

const idleSession = {
	error: undefined,
	isPending: false,
	isRefetching: false,
	refetch: noop,
};

const signedIn = {
	...idleSession,
	data: {
		session: { id: "s1", userId: "u1" },
		user: { email: "ada@example.com", id: "u1", name: "Ada" },
	},
};

const entry = (overrides: Partial<LibraryEntry> = {}): LibraryEntry => ({
	continuityId: "continuity:12",
	coverRef: undefined,
	finishedAt: undefined,
	mediaKind: "anime",
	nextUp: {
		number: 3,
		partLabel: "Cour 2",
		title: "The Informal",
	},
	personalRating: undefined,
	rewatchCount: 0,
	startedAt: undefined,
	status: "watching",
	title: "Spy × Family",
	totalInstalments: 37,
	watchedInstalments: 25,
	...overrides,
});

const htmlOf = (node: ReactNode, entries: readonly LibraryEntry[] = []) => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(libraryKey, entries);
	return renderToStaticMarkup(
		<QueryClientProvider client={client}>{node}</QueryClientProvider>,
	);
};

const continueLibrary: LibraryEntry[] = [
	entry(),
	entry({
		continuityId: "continuity:34",
		nextUp: {
			number: 1,
			partLabel: "Film",
			title: "Dawn of the Deep Soul",
		},
		status: "rewatching",
		title: "Made in Abyss",
		totalInstalments: 1,
		watchedInstalments: 0,
	}),
	entry({
		continuityId: "continuity:56",
		nextUp: undefined,
		status: "completed",
		title: "Finished",
		totalInstalments: 12,
		watchedInstalments: 12,
	}),
	entry({
		continuityId: "continuity:78",
		status: "on_hold",
		title: "Parked",
	}),
];

describe("Home", () => {
	beforeEach(() => {
		useSession.mockReset();
	});

	it("states the tracker purpose", () => {
		useSession.mockReturnValue({ ...idleSession, data: undefined });
		const html = htmlOf(<Home />);
		expect(html).toContain("mdbmap");
		expect(html).toContain("Television");
		expect(html).toContain("Film");
		expect(html).toContain("Anime");
		expect(html).toContain('href="/search"');
		expect(html).not.toContain("Design system");
	});

	it("opens the dialog when sign-in is requested", () => {
		useSession.mockReturnValue({ ...idleSession, data: undefined });
		expect(htmlOf(<Home onSigninOpenChange={noop} signinOpen />)).toContain(
			'data-dialog-open="true"',
		);
		expect(htmlOf(<Home />)).not.toContain('data-dialog-open="true"');
	});
});

describe("Home CTAs", () => {
	beforeEach(() => {
		useSession.mockReset();
	});

	it("offers sign-in and search when signed out", () => {
		useSession.mockReturnValue({ ...idleSession, data: undefined });
		const html = htmlOf(<Home />);
		expect(html).toContain("Sign in to start tracking");
		expect(html).toContain("Search catalogues");
		expect(html).toContain('href="/search"');
		expect(html).not.toContain('href="/library"');
	});

	it("offers library and search when signed in", () => {
		useSession.mockReturnValue(signedIn);
		const html = htmlOf(<Home />);
		expect(html).toContain('href="/library"');
		expect(html).toContain("Open your library");
		expect(html).toContain("Search catalogues");
		expect(html).toContain('href="/search"');
		expect(html).not.toContain("Sign in to start tracking");
	});

	it("shows neither call to action while the session is pending", () => {
		useSession.mockReturnValue({
			...idleSession,
			data: undefined,
			isPending: true,
		});
		const html = htmlOf(<Home />);
		expect(html).toContain("animate-pulse");
		expect(html).not.toContain("Sign in to start tracking");
		expect(html).not.toContain("Search catalogues");
		expect(html).not.toContain('href="/library"');
	});
});

describe("Home continue", () => {
	beforeEach(() => {
		useSession.mockReset();
	});

	it("lists watching next-up rows when signed in", () => {
		useSession.mockReturnValue(signedIn);
		const html = htmlOf(<Home />, continueLibrary);
		expect(html).toContain("Continue");
		expect(html).toContain("Spy × Family");
		expect(html).toContain("next Cour 2 · 03 · The Informal");
		expect(html).toContain('href="/work/12"');
		expect(html).toContain("Made in Abyss");
		expect(html).toContain("next Film · 01 · Dawn of the Deep Soul");
		expect(html).toContain('href="/work/34"');
		expect(html).not.toContain("Finished");
		expect(html).not.toContain("Parked");
	});

	it("hides continue when signed out", () => {
		useSession.mockReturnValue({ ...idleSession, data: undefined });
		const html = htmlOf(<Home />, [entry()]);
		expect(html).not.toContain("Continue");
		expect(html).not.toContain("Spy × Family");
		expect(html).not.toContain('href="/work/12"');
	});

	it("hides continue when the library query is empty", () => {
		useSession.mockReturnValue(signedIn);
		const html = htmlOf(<Home />, []);
		expect(html).not.toContain("Continue");
	});
});
