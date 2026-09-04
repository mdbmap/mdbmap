import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { WatchStatus } from "@/db/schema";
import type { LibraryEntry, LibrarySort } from "@/orpc/schema";

import { LibraryPage } from "./library-page";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		params,
		to,
		"data-cta": dataCta,
	}: {
		children: ReactNode;
		"data-cta"?: boolean | string;
		params?: { continuityId: number | string };
		to: string;
	}) => (
		<a
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

const onSortChange = vi.fn<(sort: LibrarySort) => void>();
const onStatusChange = vi.fn<(status: WatchStatus | undefined) => void>();

const NO_ENTRIES: LibraryEntry[] = [];

const entry = (overrides: Partial<LibraryEntry> = {}): LibraryEntry => ({
	continuityId: "continuity:12",
	coverRef: undefined,
	finishedAt: undefined,
	personalRating: undefined,
	rewatchCount: 0,
	startedAt: undefined,
	status: "watching",
	title: "Spy × Family",
	totalInstalments: 37,
	watchedInstalments: 25,
	...overrides,
});

const entries: LibraryEntry[] = [
	entry({
		personalRating: 8,
		rewatchCount: 2,
		startedAt: "2026-04-09",
	}),
	entry({
		continuityId: "continuity:34",
		coverRef: "https://img.test/abyss.jpg",
		status: "on_hold",
		title: "Made in Abyss",
		totalInstalments: 13,
		watchedInstalments: 0,
	}),
	entry({
		continuityId: "continuity:56",
		finishedAt: "2020-01-17",
		startedAt: "2020-01-17",
		title: undefined,
		totalInstalments: 1,
		watchedInstalments: 1,
	}),
];

const renderPage = (
	pageEntries: readonly LibraryEntry[],
	status?: LibraryEntry["status"],
) =>
	renderToStaticMarkup(
		<LibraryPage
			entries={pageEntries}
			onSortChange={onSortChange}
			onStatusChange={onStatusChange}
			sort="activity"
			status={status}
		/>,
	);

describe("LibraryPage rows", () => {
	const html = renderPage(entries);

	it("lists each tracked work with status, progress and rating", () => {
		expect(html).toContain("Spy × Family");
		expect(html).toContain(
			"watching · 25 / 37 · rewatch ×2 · started 2026-04-09",
		);
		expect(html).toContain("8/10");
		expect(html).toContain("Made in Abyss");
		expect(html).toContain("on hold · 0 / 13");
	});

	it("links every row to its numeric work path", () => {
		expect(html).toContain('href="/work/12"');
		expect(html).toContain('href="/work/34"');
		expect(html).toContain('href="/work/56"');
	});

	it("shows the cover when present and the ruled placeholder otherwise", () => {
		expect(html).toContain("https://img.test/abyss.jpg");
		expect(html).toContain("poster-");
	});

	it("falls back to a placeholder title when metadata is missing", () => {
		expect(html).toContain("Title unavailable");
		expect(html).toContain("finished 2020-01-17");
	});

	it("counts the tracked works and exposes status and sort controls", () => {
		expect(html).toContain("3 works");
		expect(html).toContain("Watching");
		expect(html).toContain("Recent activity");
	});
});

describe("LibraryPage empty states", () => {
	it("guides an untracked viewer to search", () => {
		const html = renderPage(NO_ENTRIES);
		expect(html).toContain("Nothing tracked yet.");
		expect(html).toContain("0 works");
		expect(html).toContain("Search catalogues");
		expect(html).toContain('href="/search"');
		expect(html).toContain("data-cta");
		expect(html).not.toContain("/work/");
	});

	it("explains an empty filtered view and offers to clear it", () => {
		const html = renderPage(NO_ENTRIES, "dropped");
		expect(html).toContain("Nothing in this view.");
		expect(html).toContain("Show all");
		expect(html).not.toContain("Search catalogues");
	});
});
