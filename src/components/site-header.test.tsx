import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SiteHeader } from "./site-header";

const { useSession } = vi.hoisted(() => ({
	useSession: vi.fn(),
}));

const noop = () => {
	/* empty */
};

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		"aria-current": ariaCurrent,
		children,
		to,
	}: {
		"aria-current"?: "page";
		children: ReactNode;
		to: string;
	}) => (
		<a aria-current={ariaCurrent} href={to}>
			{children}
		</a>
	),
}));

vi.mock("@/integrations/better-auth/header-user", () => ({
	BetterAuthHeader: () => false,
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		useSession,
	},
}));

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

const classOf = (html: string, href: string) => {
	const marker = `href="${href}"`;
	const hrefAt = html.indexOf(marker);
	if (hrefAt === -1) {
		return;
	}
	const spanAt = html.indexOf('<span class="', hrefAt);
	if (spanAt === -1) {
		return;
	}
	const from = spanAt + '<span class="'.length;
	const stop = html.indexOf('"', from);
	return html.slice(from, stop);
};

describe("SiteHeader", () => {
	beforeEach(() => {
		useSession.mockReset();
	});

	it("links brand and search when signed out", () => {
		useSession.mockReturnValue({ ...idleSession, data: undefined });
		const html = renderToStaticMarkup(<SiteHeader />);
		expect(html).toContain('href="/"');
		expect(html).toContain('href="/search"');
		expect(html).not.toContain('href="/library"');
		expect(html).toContain("px-8 py-3.5");
	});

	it("links library when signed in", () => {
		useSession.mockReturnValue(signedIn);
		const html = renderToStaticMarkup(<SiteHeader current="library" />);
		expect(html).toContain('href="/"');
		expect(html).toContain('href="/search"');
		expect(html).toContain('href="/library"');
		expect(classOf(html, "/library")).toContain("text-accent");
	});

	it("hides library while the session is pending", () => {
		useSession.mockReturnValue({
			...idleSession,
			data: undefined,
			isPending: true,
		});
		const html = renderToStaticMarkup(<SiteHeader />);
		expect(html).toContain('href="/"');
		expect(html).toContain('href="/search"');
		expect(html).not.toContain('href="/library"');
	});

	it("marks the current item and keeps the wordmark accented", () => {
		useSession.mockReturnValue(signedIn);
		const html = renderToStaticMarkup(<SiteHeader current="search" />);
		expect(classOf(html, "/search")).toContain("text-accent");
		expect(html).toContain('aria-current="page"');
		expect(classOf(html, "/")).toContain("text-accent");
		expect(classOf(html, "/library")).toContain("text-ink/50");
	});

	it("omits header padding when nested in an already padded shell", () => {
		useSession.mockReturnValue({ ...idleSession, data: undefined });
		const html = renderToStaticMarkup(<SiteHeader padded={false} />);
		expect(html).not.toContain("px-8");
		expect(html).not.toContain("py-3.5");
	});
});
