import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { BetterAuthHeader } from "./header-user";

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

vi.mock("react-aria-components", async () => {
	const { createElement, Fragment } = await import("react");
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
		DialogTrigger: ({ children }: { children?: ReactNode }) =>
			createElement(Fragment, undefined, children),
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

describe("BetterAuthHeader", () => {
	beforeEach(() => {
		useSession.mockReset();
	});

	it("shows sign-in when there is no session", () => {
		useSession.mockReturnValue({ ...idleSession, data: undefined });
		const html = renderToStaticMarkup(<BetterAuthHeader />);
		expect(html).toContain("Sign in");
		expect(html).not.toContain("Sign out");
	});

	it("shows the signed-in user and sign-out", () => {
		useSession.mockReturnValue({
			...idleSession,
			data: {
				session: { id: "s1", userId: "u1" },
				user: { email: "ada@example.com", id: "u1", name: "Ada" },
			},
		});
		const html = renderToStaticMarkup(<BetterAuthHeader />);
		expect(html).toContain("Ada");
		expect(html).toContain("Settings");
		expect(html).toContain("Sign out");
		expect(html).not.toContain("Sign in");
	});
});
