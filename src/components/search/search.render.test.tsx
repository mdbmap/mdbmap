import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SearchHit } from "@/orpc/schema";

import { SearchPage } from "./search-page";
import type { SearchView } from "./search-page";

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
		<a href={to.replace("$continuityId", String(params?.continuityId))}>
			{children}
		</a>
	),
}));

vi.mock("@/integrations/better-auth/header-user", () => ({
	BetterAuthHeader: () => false,
}));

const noop = (_value: string) => {
	/* empty */
};

const hit = (overrides: Partial<SearchHit> = {}): SearchHit => ({
	catalogue: {
		id: "603",
		namespace: "movie",
		service: "tmdb",
	},
	continuityId: undefined,
	coverRef: undefined,
	mediaKind: "film",
	title: "The Matrix",
	year: 1999,
	...overrides,
});

const hits: SearchHit[] = [
	hit({
		continuityId: "continuity:12",
		coverRef: "https://img.test/matrix.jpg",
	}),
	hit({
		catalogue: { id: "1396", namespace: "tv", service: "tmdb" },
		mediaKind: "tv",
		title: "Breaking Bad",
		year: 2008,
	}),
	hit({
		catalogue: { id: "21", service: "anilist" },
		mediaKind: "anime",
		title: "One Piece",
		year: undefined,
	}),
];

const idleView = { kind: "idle" } as const satisfies SearchView;
const pendingView = { kind: "pending" } as const satisfies SearchView;
const errorView = { kind: "error" } as const satisfies SearchView;
const emptyView = { kind: "empty" } as const satisfies SearchView;
const readyView = { hits, kind: "ready" } as const satisfies SearchView;

describe("SearchPage idle", () => {
	const html = renderToStaticMarkup(
		<SearchPage draft="" onDraftChange={noop} view={idleView} />,
	);

	it("prompts for a query before fetching", () => {
		expect(html).toContain("Type a title to search.");
		expect(html).toContain('type="search"');
		expect(html).not.toContain("/work/");
	});
});

describe("SearchPage populated list", () => {
	const html = renderToStaticMarkup(
		<SearchPage draft="matrix" onDraftChange={noop} view={readyView} />,
	);

	it("lists title, media kind, year and cover", () => {
		expect(html).toContain("The Matrix");
		expect(html).toContain("film · 1999");
		expect(html).toContain("https://img.test/matrix.jpg");
		expect(html).toContain("Breaking Bad");
		expect(html).toContain("tv · 2008");
		expect(html).toContain("One Piece");
		expect(html).toContain("anime");
		expect(html).toContain("poster-300");
	});

	it("links mapped hits and keeps unmapped rows keyboard-focusable", () => {
		expect(html).toContain('href="/work/12"');
		expect(html).toContain('type="button"');
		expect(html.match(/href="\/work\//gu) ?? []).toHaveLength(1);
	});
});

describe("SearchPage empty results", () => {
	const html = renderToStaticMarkup(
		<SearchPage draft="zzzz" onDraftChange={noop} view={emptyView} />,
	);

	it("states that the query returned no matches", () => {
		expect(html).toContain("No matches.");
		expect(html).not.toContain("/work/");
	});
});

describe("SearchPage pending and error", () => {
	it("shows a pending label while fetching", () => {
		const html = renderToStaticMarkup(
			<SearchPage draft="matrix" onDraftChange={noop} view={pendingView} />,
		);
		expect(html).toContain("Searching…");
	});

	it("shows an error state when the catalogues fail", () => {
		const html = renderToStaticMarkup(
			<SearchPage draft="matrix" onDraftChange={noop} view={errorView} />,
		);
		expect(html).toContain("Search failed.");
	});
});
