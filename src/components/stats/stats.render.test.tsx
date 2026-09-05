import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { LibraryEntry } from "@/orpc/schema";

import { StatsPage } from "./stats-page";

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

vi.mock("@/integrations/better-auth/header-user", () => ({
	BetterAuthHeader: () => false,
}));

const NO_ENTRIES: LibraryEntry[] = [];

const entry = (overrides: Partial<LibraryEntry> = {}): LibraryEntry => ({
	continuityId: "continuity:12",
	coverRef: undefined,
	finishedAt: undefined,
	mediaKind: "anime",
	personalRating: undefined,
	rewatchCount: 0,
	startedAt: undefined,
	status: "watching",
	title: "Spy × Family",
	totalInstalments: 37,
	watchedInstalments: 25,
	...overrides,
});

const noRuntimeEntries: LibraryEntry[] = [entry()];

const knownRuntimeEntries: LibraryEntry[] = [
	entry({ runtimeMinutes: 24, watchedInstalments: 25 }),
	entry({
		continuityId: "continuity:34",
		runtimeMinutes: 12,
		watchedInstalments: 13,
	}),
];

const entries: LibraryEntry[] = [
	entry({ personalRating: 8, rewatchCount: 2, runtimeMinutes: 24 }),
	entry({
		continuityId: "continuity:34",
		mediaKind: "film",
		personalRating: 9,
		runtimeMinutes: 12,
		status: "completed",
		title: "Made in Abyss",
		totalInstalments: 13,
		watchedInstalments: 13,
	}),
	entry({
		continuityId: "continuity:56",
		mediaKind: "tv",
		status: "on_hold",
		title: "Frieren",
		totalInstalments: 28,
		watchedInstalments: 4,
	}),
];

describe("StatsPage snapshot", () => {
	const html = renderToStaticMarkup(<StatsPage entries={entries} />);

	it("titles the page and counts tracked works", () => {
		expect(html).toContain("Stats");
		expect(html).toContain("A snapshot of what you track.");
		expect(html).toContain("3 works");
		expect(html).toContain('href="/library"');
		expect(html).toContain('href="/history"');
		expect(html).toContain('href="/"');
	});

	it("lists every watch status including zeros", () => {
		expect(html).toContain("watching");
		expect(html).toContain("on hold");
		expect(html).toContain("completed");
		expect(html).toContain("dropped");
		expect(html).toContain("rewatching");
		expect(html).toContain("plan to watch");
		expect(html).toContain(">1<");
		expect(html).toContain(">0<");
	});

	it("shows mean rating, rated count, instalments, hours and rewatch", () => {
		expect(html).toContain("8.5/10 · 2 rated");
		expect(html).toContain("42 / 78");
		expect(html).toContain("hours watched");
		expect(html).toContain("12h 36m · some titles omitted");
		expect(html).toContain("rewatch");
		expect(html).toContain("×2");
	});

	it("lists work counts by media kind", () => {
		expect(html).toContain("Anime");
		expect(html).toContain("Film");
		expect(html).toContain("TV");
	});
});

describe("StatsPage empty state", () => {
	const html = renderToStaticMarkup(<StatsPage entries={NO_ENTRIES} />);

	it("guides an untracked viewer to search", () => {
		expect(html).toContain("Nothing tracked yet.");
		expect(html).toContain("0 works");
		expect(html).toContain("Search catalogues");
		expect(html).toContain('href="/search"');
		expect(html).toContain("data-cta");
		expect(html).not.toContain("personal rating");
		expect(html).not.toContain("hours watched");
		expect(html).not.toContain("<form");
	});
});

describe("StatsPage hours watched", () => {
	it("notes omitted titles when no runtime is known", () => {
		const html = renderToStaticMarkup(<StatsPage entries={noRuntimeEntries} />);
		expect(html).toContain("hours watched");
		expect(html).toContain("0m · some titles omitted");
		expect(html).not.toContain("12h 36m");
	});

	it("shows a complete total when every watched title has runtime", () => {
		const html = renderToStaticMarkup(
			<StatsPage entries={knownRuntimeEntries} />,
		);
		expect(html).toContain("12h 36m");
		expect(html).not.toContain("some titles omitted");
	});
});
