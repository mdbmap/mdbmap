import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { WatchStatus } from "@/db/schema";
import type { MediaKind } from "@/engine";
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

vi.mock("@/lib/auth-client", () => ({
	authClient: {
		useSession: () => ({
			data: undefined,
			isPending: false,
		}),
	},
}));

const onSortChange = vi.fn<(sort: LibrarySort) => void>();
const onStatusChange = vi.fn<(status: WatchStatus | undefined) => void>();
const onKindChange = vi.fn<(kind: MediaKind | undefined) => void>();
const onQueryChange = vi.fn<(query: string) => void>();

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

const entries: LibraryEntry[] = [
	entry({
		nextUp: {
			number: 3,
			partLabel: "Cour 2",
			title: "The Informal",
		},
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
		mediaKind: "film",
		startedAt: "2020-01-17",
		title: undefined,
		totalInstalments: 1,
		watchedInstalments: 1,
	}),
];

const renderPage = (
	pageEntries: readonly LibraryEntry[],
	status?: LibraryEntry["status"],
	find?: { kind?: MediaKind; query?: string },
) =>
	renderToStaticMarkup(
		<LibraryPage
			entries={pageEntries}
			kind={find?.kind}
			onKindChange={onKindChange}
			onQueryChange={onQueryChange}
			onSortChange={onSortChange}
			onStatusChange={onStatusChange}
			query={find?.query ?? ""}
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
		expect(html).toContain("next Cour 2 · 03 · The Informal");
		expect(html).toContain("8/10");
		expect(html).toContain("Made in Abyss");
		expect(html).toContain("on hold · 0 / 13");
	});

	it("renders plan_to_watch without a leftover underscore", () => {
		const queued = renderPage([
			entry({ status: "plan_to_watch", title: "Frieren" }),
		]);
		expect(queued).toContain("plan to watch · 25 / 37");
		expect(queued).not.toContain("plan to_watch");
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

	it("counts the tracked works and exposes status, sort and find controls", () => {
		expect(html).toContain("3 works");
		expect(html).toContain("Watching");
		expect(html).toContain("Plan to watch");
		expect(html).toContain("Recent activity");
		expect(html).toContain("Title…");
		expect(html).toContain("Any kind");
		expect(html).toContain("Anime");
		expect(html).toContain("Film");
		expect(html).toContain("TV");
		expect(html).toContain('aria-label="Media kind"');
	});

	it("links the brand home and search in the site header", () => {
		expect(html).toContain('href="/"');
		expect(html).toContain('href="/search"');
		expect(html).not.toContain('href="/library"');
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
		expect(html).toContain('href="/"');
		expect(html).not.toContain("/work/");
	});

	it("explains an empty filtered view and offers to clear it", () => {
		const html = renderPage(NO_ENTRIES, "dropped");
		expect(html).toContain("Nothing in this view.");
		expect(html).toContain("Show all");
		expect(html).not.toContain("Search catalogues");
	});

	it("treats a kind filter on an empty library as a filtered view", () => {
		const html = renderPage(NO_ENTRIES, undefined, { kind: "tv" });
		expect(html).toContain("Nothing in this view.");
		expect(html).toContain("Show all");
		expect(html).not.toContain("Nothing tracked yet.");
	});

	it("treats a title query on an empty library as a filtered view", () => {
		const html = renderPage(NO_ENTRIES, undefined, { query: "abyss" });
		expect(html).toContain("Nothing in this view.");
		expect(html).not.toContain("Nothing tracked yet.");
	});
});

describe("LibraryPage findability", () => {
	it("hides titles that do not match the query", () => {
		const html = renderPage(entries, undefined, { query: "abyss" });
		expect(html).toContain("Made in Abyss");
		expect(html).toContain("1 work");
		expect(html).not.toContain("Spy × Family");
		expect(html).not.toContain("Title unavailable");
	});

	it("matches titles case-insensitively and skips untitled works", () => {
		const html = renderPage(entries, undefined, { query: "FAMILY" });
		expect(html).toContain("Spy × Family");
		expect(html).not.toContain("Made in Abyss");
		expect(html).not.toContain("Title unavailable");
	});

	it("filters by media kind", () => {
		const html = renderPage(entries, undefined, { kind: "film" });
		expect(html).toContain("Title unavailable");
		expect(html).toContain("1 work");
		expect(html).not.toContain("Spy × Family");
		expect(html).not.toContain("Made in Abyss");
	});

	it("explains when title or kind filters match nothing", () => {
		const html = renderPage(entries, undefined, { query: "no-such-title" });
		expect(html).toContain("Nothing in this view.");
		expect(html).toContain("0 works");
		expect(html).toContain("Show all");
		expect(html).not.toContain("Nothing tracked yet.");
		expect(html).not.toContain("Spy × Family");
	});
});

describe("LibraryPage find composition", () => {
	it("explains when a kind filter matches nothing", () => {
		const html = renderPage(entries, undefined, { kind: "tv" });
		expect(html).toContain("Nothing in this view.");
		expect(html).toContain("0 works");
		expect(html).not.toContain("Spy × Family");
		expect(html).not.toContain("Made in Abyss");
		expect(html).not.toContain("Title unavailable");
	});

	it("keeps a trailing space in the title field", () => {
		const html = renderPage(entries, undefined, { query: "abyss " });
		expect(html).toContain('value="abyss "');
		expect(html).toContain("Made in Abyss");
		expect(html).toContain("1 work");
	});

	it("composes status, kind and title filters", () => {
		const mixed: LibraryEntry[] = [
			entry(),
			entry({
				continuityId: "continuity:34",
				status: "completed",
				title: "Made in Abyss",
			}),
			entry({
				continuityId: "continuity:56",
				mediaKind: "tv",
				title: "Frieren",
			}),
		];
		const html = renderPage(mixed, "watching", {
			kind: "anime",
			query: "spy",
		});
		expect(html).toContain("Spy × Family");
		expect(html).toContain("1 work");
		expect(html).not.toContain("Made in Abyss");
		expect(html).not.toContain("Frieren");
	});
});
