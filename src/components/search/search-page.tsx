import { Link } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import type { ChangeEvent } from "react";
import { tv } from "tailwind-variants";

import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { imageUrl, posterHue } from "@/components/work/metadata/placeholders";
import { workPathId } from "@/engine/continuity/keys";
import { BetterAuthHeader } from "@/integrations/better-auth/header-user";
import type { SearchHit } from "@/orpc/schema";

const BRAND = "mdbmap";
const TITLE = "Search";
const TAGLINE = "Television, film and anime across catalogues.";
const SEARCH_NAV = "Search";
const INPUT_LABEL = "Query";
const INPUT_PLACEHOLDER = "Title…";
const IDLE_HEADING = "Type a title to search.";
const IDLE_BODY =
	"Results come from live catalogues, then pick up any continuity we already know.";
const PENDING = "Searching…";
const EMPTY_HEADING = "No matches.";
const EMPTY_BODY = "Try a different spelling or a shorter query.";
const ERROR_HEADING = "Search failed.";
const ERROR_BODY =
	"Something went wrong talking to the catalogues. Try again in a moment.";

const row = tv({
	base: "border-line hover:bg-ink/[0.04] focus-visible:bg-ink/[0.04] border-t outline-none *:flex *:items-start *:gap-4 *:px-8 *:py-4",
});

const cover = tv({
	base: "border-line aspect-[2/3] w-12 shrink-0 border",
});

type SearchView =
	| { kind: "idle" }
	| { kind: "pending" }
	| { kind: "error" }
	| { kind: "empty" }
	| { kind: "ready"; hits: readonly SearchHit[] };

interface SearchPageProps {
	draft: string;
	onDraftChange: (value: string) => void;
	view: SearchView;
}

const hitKey = (hit: SearchHit): string => {
	const { catalogue } = hit;
	if (catalogue.service === "tmdb") {
		return `tmdb:${catalogue.namespace}:${catalogue.id}`;
	}
	return `${catalogue.service}:${catalogue.id}`;
};

const metaLine = (hit: SearchHit) =>
	[hit.mediaKind, hit.year === undefined ? undefined : String(hit.year)]
		.filter((part) => part !== undefined)
		.join(" · ");

function Cover({ hue, src }: { hue: string; src: string | undefined }) {
	if (src === undefined) {
		return <div className={`${cover()} ${hue}`} />;
	}
	return <img alt="" className={`${cover()} object-cover`} src={src} />;
}

function HitBody({ hit, hue }: { hit: SearchHit; hue: string }) {
	return (
		<>
			<Cover hue={hue} src={imageUrl(hit.coverRef)} />
			<div className="min-w-0 flex-1">
				<h2 className="text-ink/95 truncate font-serif text-xl italic">
					{hit.title}
				</h2>
				<p className="text-ink/50 mt-1 font-mono text-[11px] capitalize">
					{metaLine(hit)}
				</p>
			</div>
		</>
	);
}

function UnmappedHit({ hit, hue }: { hit: SearchHit; hue: string }) {
	return (
		<li className={row()}>
			<button className="w-full cursor-default text-left" type="button">
				<HitBody hit={hit} hue={hue} />
			</button>
		</li>
	);
}

function MappedHit({ hit, hue }: { hit: SearchHit; hue: string }) {
	const continuityId = workPathId(hit.continuityId ?? "");
	const params = useMemo(
		() => (continuityId === undefined ? undefined : { continuityId }),
		[continuityId],
	);
	if (params === undefined) {
		return <UnmappedHit hit={hit} hue={hue} />;
	}
	return (
		<li className={row()}>
			<Link params={params} to="/work/$continuityId">
				<HitBody hit={hit} hue={hue} />
			</Link>
		</li>
	);
}

function SearchHeader() {
	return (
		<header className="flex items-center justify-between px-8 py-3.5">
			<nav className="flex items-center gap-5">
				<span className="text-accent font-mono text-xs font-medium tracking-[0.1em] uppercase">
					{BRAND}
				</span>
				<span className="text-accent font-mono text-xs tracking-[0.1em] uppercase">
					{SEARCH_NAV}
				</span>
			</nav>
			<div className="flex items-center gap-4">
				<BetterAuthHeader />
				<ThemeToggle />
			</div>
		</header>
	);
}

function StatusBlock({ body, heading }: { body: string; heading: string }) {
	return (
		<div className="border-line border-t px-8 py-16">
			<p className="text-ink/90 font-serif text-2xl italic">{heading}</p>
			<p className="text-ink/70 mt-3 max-w-[56ch] text-[15px] leading-relaxed">
				{body}
			</p>
		</div>
	);
}

function PendingBlock() {
	return (
		<div className="border-line border-t px-8 py-16">
			<p className="text-ink/50 font-mono text-xs tracking-[0.08em] uppercase">
				{PENDING}
			</p>
		</div>
	);
}

function Results({ hits }: { hits: readonly SearchHit[] }) {
	return (
		<ul>
			{hits.map((hit, index) => (
				<MappedHit hit={hit} hue={posterHue(index)} key={hitKey(hit)} />
			))}
		</ul>
	);
}

function SearchBody({ view }: { view: SearchView }) {
	switch (view.kind) {
		case "idle": {
			return <StatusBlock body={IDLE_BODY} heading={IDLE_HEADING} />;
		}
		case "pending": {
			return <PendingBlock />;
		}
		case "error": {
			return <StatusBlock body={ERROR_BODY} heading={ERROR_HEADING} />;
		}
		case "empty": {
			return <StatusBlock body={EMPTY_BODY} heading={EMPTY_HEADING} />;
		}
		case "ready": {
			return <Results hits={view.hits} />;
		}
	}
}

function QueryField({
	draft,
	onDraftChange,
}: {
	draft: string;
	onDraftChange: (value: string) => void;
}) {
	const handleChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			onDraftChange(event.target.value);
		},
		[onDraftChange],
	);
	return (
		<input
			aria-label={INPUT_LABEL}
			autoCapitalize="off"
			autoComplete="off"
			autoCorrect="off"
			className="border-line text-ink/95 placeholder:text-ink/35 mt-8 w-full border bg-transparent px-3 py-2.5 font-serif text-xl italic outline-none focus:border-[var(--color-accent)]"
			onChange={handleChange}
			placeholder={INPUT_PLACEHOLDER}
			spellCheck={false}
			type="search"
			value={draft}
		/>
	);
}

function SearchIntro({
	draft,
	onDraftChange,
}: {
	draft: string;
	onDraftChange: (value: string) => void;
}) {
	return (
		<section className="px-8 pt-6 pb-7">
			<Label>{INPUT_LABEL}</Label>
			<h1 className="text-ink/95 mt-1 font-serif text-4xl italic">{TITLE}</h1>
			<p className="text-ink/60 mt-2 font-mono text-xs">{TAGLINE}</p>
			<QueryField draft={draft} onDraftChange={onDraftChange} />
		</section>
	);
}

function SearchPage({ draft, onDraftChange, view }: SearchPageProps) {
	return (
		<main className="mx-auto min-h-screen max-w-[1200px] pb-24">
			<SearchHeader />
			<SearchIntro draft={draft} onDraftChange={onDraftChange} />
			<SearchBody view={view} />
		</main>
	);
}

export { SearchPage, type SearchView };
