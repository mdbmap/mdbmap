import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { LibraryEntry } from "@/orpc/schema";

import { LibraryPage } from "./library-page";

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

vi.mock("@/integrations/better-auth/header-user", () => ({
	BetterAuthHeader: () => false,
}));

const NO_ENTRIES: LibraryEntry[] = [];

const entry = (overrides: Partial<LibraryEntry> = {}): LibraryEntry => ({
	continuityId: "continuity:12",
	coverRef: undefined,
	personalRating: undefined,
	rewatchCount: 0,
	status: "watching",
	title: "Spy × Family",
	totalInstalments: 37,
	watchedInstalments: 25,
	...overrides,
});

const entries: LibraryEntry[] = [
	entry({ personalRating: 8, rewatchCount: 2 }),
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
		title: undefined,
		totalInstalments: 1,
		watchedInstalments: 1,
	}),
];

describe("LibraryPage rows", () => {
	const html = renderToStaticMarkup(<LibraryPage entries={entries} />);

	it("lists each tracked work with status, progress and rating", () => {
		expect(html).toContain("Spy × Family");
		expect(html).toContain("watching · 25 / 37 · rewatch ×2");
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
		expect(html).toContain("poster-340");
	});

	it("falls back to a placeholder title when metadata is missing", () => {
		expect(html).toContain("Title unavailable");
	});

	it("counts the tracked works in the header", () => {
		expect(html).toContain("3 works");
	});
});

describe("LibraryPage empty state", () => {
	const html = renderToStaticMarkup(<LibraryPage entries={NO_ENTRIES} />);

	it("guides an untracked viewer back to the start", () => {
		expect(html).toContain("Nothing tracked yet.");
		expect(html).toContain("0 works");
		expect(html).toContain('href="/"');
		expect(html).toContain('href="/search"');
		expect(html).not.toContain("/work/");
	});
});
