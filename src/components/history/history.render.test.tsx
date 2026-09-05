import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { HistoryEntry } from "@/orpc/schema";

import { HistoryPage } from "./history-page";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		"aria-current": ariaCurrent,
		children,
		params,
		to,
		"data-cta": dataCta,
	}: {
		"aria-current"?: "page";
		children: ReactNode;
		"data-cta"?: boolean | string;
		params?: { continuityId: number | string };
		to: string;
	}) => (
		<a
			aria-current={ariaCurrent}
			data-cta={dataCta === undefined ? undefined : ""}
			href={to.replace("$continuityId", String(params?.continuityId ?? ""))}
		>
			{children}
		</a>
	),
}));

vi.mock("@/integrations/better-auth/header-user", () => ({
	BetterAuthHeader: () => false,
}));

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		useSession: () => ({
			data: {
				user: { email: "ada@example.com", id: "u1", name: "Ada" },
			},
			isPending: false,
		}),
	},
}));

const NO_ENTRIES: HistoryEntry[] = [];

const entries: HistoryEntry[] = [
	{
		continuityId: "continuity:12",
		coverRef: "https://img.test/spy.jpg",
		instalmentTitle: "The Informal",
		mediaKind: "anime",
		number: 3,
		partLabel: "Cour 2",
		watchedAt: "2026-04-10T21:15:00.000Z",
		workTitle: "Spy × Family",
	},
	{
		continuityId: "continuity:12",
		coverRef: "https://img.test/spy.jpg",
		instalmentTitle: "Operation Strix",
		mediaKind: "anime",
		number: 1,
		partLabel: "Cour 1",
		watchedAt: "2026-04-09T12:00:00.000Z",
		workTitle: "Spy × Family",
	},
	{
		continuityId: "continuity:34",
		coverRef: undefined,
		instalmentTitle: "The Matrix",
		mediaKind: "film",
		number: 1,
		partLabel: "Film",
		watchedAt: "2026-04-09T08:00:00.000Z",
		workTitle: "The Matrix",
	},
];

describe("HistoryPage rows", () => {
	const html = renderToStaticMarkup(<HistoryPage entries={entries} />);

	it("groups instalments by UTC day and links each work", () => {
		expect(html).toContain("History");
		expect(html).toContain("Recently watched instalments, newest first.");
		expect(html).toContain("2026-04-10");
		expect(html).toContain("2026-04-09");
		expect(html).toContain("Spy × Family");
		expect(html).toContain("Cour 2 · 03 · The Informal");
		expect(html).toContain("Cour 1 · 01 · Operation Strix");
		expect(html).toContain("Film · 01 · The Matrix");
		expect(html).toContain('href="/work/12"');
		expect(html).toContain('href="/work/34"');
		expect(html).toContain("https://img.test/spy.jpg");
		expect(html).toContain("poster-");
	});

	it("marks History as the current signed-in nav item", () => {
		expect(html).toContain('aria-current="page"');
		expect(html).toContain('href="/history"');
		expect(html).toContain('href="/library"');
		expect(html).toContain('href="/calendar"');
		expect(html).toContain('href="/stats"');
	});
});

describe("HistoryPage empty state", () => {
	const html = renderToStaticMarkup(<HistoryPage entries={NO_ENTRIES} />);

	it("guides a viewer with nothing watched to library and search", () => {
		expect(html).toContain("Nothing watched yet.");
		expect(html).toContain("Library");
		expect(html).toContain("Search catalogues");
		expect(html).toContain('href="/library"');
		expect(html).toContain('href="/search"');
		expect(html).toContain("data-cta");
		expect(html).not.toContain("/work/");
	});
});
