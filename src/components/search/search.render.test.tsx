import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { SearchHit } from "@/orpc/schema";

import { OPENING } from "./open-hit";
import { SearchPage, UnmappedHitView } from "./search-page";
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
	useNavigate: () => vi.fn(),
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

vi.mock("./use-open-hit", () => ({
	useOpenHit: () => ({
		onOpen: () => {
			/* empty */
		},
		state: { kind: "idle" as const },
	}),
}));

const noop = (_value: string) => {
	/* empty */
};

const noopOpen = () => {
	/* empty */
};

const openingState = { kind: "opening" } as const;
const openErrorState = {
	kind: "error",
	message: "This title could not be opened from the catalogues.",
} as const;

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

	it("links the brand home and search in the site header", () => {
		expect(html).toContain('href="/"');
		expect(html).toContain('href="/search"');
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

	it("links mapped hits and keeps unmapped rows as open buttons", () => {
		expect(html).toContain('href="/work/12"');
		expect(html).toContain('aria-label="Open"');
		expect(html).toContain('type="button"');
		expect(html.match(/href="\/work\//gu) ?? []).toHaveLength(1);
	});
});

describe("UnmappedHitView open states", () => {
	const unmapped = hit({
		catalogue: { id: "1396", namespace: "tv", service: "tmdb" },
		mediaKind: "tv",
		title: "Breaking Bad",
		year: 2008,
	});

	it("shows an opening label while the open mutation runs", () => {
		const html = renderToStaticMarkup(
			<ul>
				<UnmappedHitView
					hit={unmapped}
					hue="poster-300"
					onOpen={noopOpen}
					state={openingState}
				/>
			</ul>,
		);
		expect(html).toContain(OPENING);
		expect(html).toContain('aria-busy="true"');
	});

	it("shows a clear error when open cannot resolve a work", () => {
		const html = renderToStaticMarkup(
			<ul>
				<UnmappedHitView
					hit={unmapped}
					hue="poster-300"
					onOpen={noopOpen}
					state={openErrorState}
				/>
			</ul>,
		);
		expect(html).toContain(
			"This title could not be opened from the catalogues.",
		);
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
