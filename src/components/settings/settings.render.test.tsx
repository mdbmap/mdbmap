import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { LibraryEntry } from "@/orpc/schema";

import { SettingsPage } from "./settings-page";

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

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		"data-cta": dataCta,
	}: {
		children: ReactNode;
		"data-cta"?: boolean | string;
		to: string;
	}) => (
		<a data-cta={dataCta === undefined ? undefined : ""} href={to}>
			{children}
		</a>
	),
}));

vi.mock("@/orpc/client", () => ({
	orpc: {
		billing: {
			createCheckout: {
				mutationOptions: (options?: object) => ({
					mutationFn: () => ({ url: "https://stripe.test/checkout" }),
					...options,
				}),
			},
			createPortal: {
				mutationOptions: (options?: object) => ({
					mutationFn: () => ({ url: "https://stripe.test/portal" }),
					...options,
				}),
			},
			status: {
				queryOptions: () => ({
					queryFn: () => ({
						hasCustomer: false,
						status: "inactive",
					}),
					queryKey: ["billing", "status"],
				}),
			},
		},
		import: {
			apply: {
				mutationOptions: (options?: object) => ({
					mutationFn: noop,
					...options,
				}),
			},
			draftAnilist: {
				mutationOptions: (options?: object) => ({
					mutationFn: noop,
					...options,
				}),
			},
			draftMal: {
				mutationOptions: (options?: object) => ({
					mutationFn: noop,
					...options,
				}),
			},
		},
		sync: {
			connect: {
				mutationOptions: (options?: object) => ({
					mutationFn: noop,
					...options,
				}),
			},
			disconnect: {
				mutationOptions: (options?: object) => ({
					mutationFn: noop,
					...options,
				}),
			},
			list: {
				queryKey: () => ["sync", "list"],
				queryOptions: () => ({
					queryFn: () => [],
					queryKey: ["sync", "list"],
				}),
			},
			pushLibrary: {
				mutationOptions: (options?: object) => ({
					mutationFn: noop,
					...options,
				}),
			},
		},
	},
}));

vi.mock("@/integrations/better-auth/header-user", () => ({
	BetterAuthHeader: () => false,
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

const entry: LibraryEntry = {
	continuityId: "c1",
	coverRef: undefined,
	finishedAt: undefined,
	mediaKind: "anime",
	personalRating: 8,
	rewatchCount: 0,
	startedAt: undefined,
	status: "watching",
	title: "Demo",
	totalInstalments: 12,
	watchedInstalments: 3,
};

const entries: LibraryEntry[] = [entry];

const htmlOf = (node: ReactNode) =>
	renderToStaticMarkup(
		<QueryClientProvider client={new QueryClient()}>
			{node}
		</QueryClientProvider>,
	);

describe("SettingsPage", () => {
	beforeEach(() => {
		useSession.mockReset();
		useSession.mockReturnValue(signedIn);
	});

	it("shows the signed-in account and an export control", () => {
		const html = htmlOf(<SettingsPage entries={entries} />);
		expect(html).toContain("Settings");
		expect(html).toContain("Ada");
		expect(html).toContain("ada@example.com");
		expect(html).toContain("Export library");
		expect(html).toContain("Paid sync");
		expect(html).toContain("Start checkout");
		expect(html).toContain('href="/"');
		expect(html).toContain('href="/search"');
		expect(html).toContain('href="/library"');
	});
});
