import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Home } from "./home";

const { useSession } = vi.hoisted(() => ({
	useSession: vi.fn(),
}));

const noop = () => {
	/* empty */
};

vi.mock("@tanstack/react-router", () => ({
	Link: ({ children, to }: { children: ReactNode; to: string }) => (
		<a href={to}>{children}</a>
	),
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		signIn: { email: vi.fn() },
		signOut: vi.fn(),
		signUp: { email: vi.fn() },
		useSession,
	},
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

describe("Home", () => {
	beforeEach(() => {
		useSession.mockReset();
	});

	it("states the tracker purpose", () => {
		useSession.mockReturnValue({ ...idleSession, data: undefined });
		const html = renderToStaticMarkup(<Home />);
		expect(html).toContain("mdbmap");
		expect(html).toContain("Television");
		expect(html).toContain("Film");
		expect(html).toContain("Anime");
		expect(html).toContain('href="/"');
		expect(html).toContain('href="/search"');
		expect(html).not.toContain("Design system");
	});

	it("opens the dialog when sign-in is requested", () => {
		useSession.mockReturnValue({ ...idleSession, data: undefined });
		expect(
			renderToStaticMarkup(<Home onSigninOpenChange={noop} signinOpen />),
		).toContain('data-dialog-open="true"');
		expect(renderToStaticMarkup(<Home />)).not.toContain(
			'data-dialog-open="true"',
		);
	});
});

describe("Home CTAs", () => {
	beforeEach(() => {
		useSession.mockReset();
	});

	it("offers sign-in and search when signed out", () => {
		useSession.mockReturnValue({ ...idleSession, data: undefined });
		const html = renderToStaticMarkup(<Home />);
		expect(html).toContain("Sign in to start tracking");
		expect(html).toContain("Search catalogues");
		expect(html).toContain('href="/"');
		expect(html).toContain('href="/search"');
		expect(html).not.toContain('href="/library"');
	});

	it("offers library and search when signed in", () => {
		useSession.mockReturnValue(signedIn);
		const html = renderToStaticMarkup(<Home />);
		expect(html).toContain('href="/"');
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
		const html = renderToStaticMarkup(<Home />);
		expect(html).toContain("animate-pulse");
		expect(html).not.toContain("Sign in to start tracking");
		expect(html).not.toContain("Search catalogues");
		expect(html).toContain('href="/"');
		expect(html).toContain('href="/search"');
		expect(html).not.toContain('href="/library"');
	});
});
