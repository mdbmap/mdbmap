import { Link } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";
import { tv } from "tailwind-variants";

import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { imageUrl, posterHue } from "@/components/work/metadata/placeholders";
import type { WatchStatus } from "@/db/schema";
import { workPathId } from "@/engine/continuity/keys";
import { BetterAuthHeader } from "@/integrations/better-auth/header-user";
import type { LibraryEntry, LibrarySort } from "@/orpc/schema";

import { LibraryControls } from "./library-controls";

const BRAND = "mdbmap";
const TITLE = "Library";
const TAGLINE = "Everything you track, filtered and sorted your way.";
const EMPTY_HEADING = "Nothing tracked yet.";
const EMPTY_BODY =
	"Open a work and set a watch status or tick an episode. It shows up here the moment you do.";
const EMPTY_CTA = "Search catalogues";
const SEARCH_NAV = "Search";
const SEARCH_PATH = "/search";
const STATS_NAV = "Stats";
const STATS_PATH = "/stats";
const UNTITLED = "Title unavailable";
const UNRATED = "—";
const OUT_OF_TEN = "/10";
const FILTER_EMPTY_HEADING = "Nothing in this view.";
const FILTER_EMPTY_BODY =
	"No tracked works match this status. Clear the filter to see everything again.";
const CLEAR_FILTER = "Show all";

const row = tv({
	base: "border-line hover:bg-ink/[0.04] border-t *:flex *:items-start *:gap-4 *:px-8 *:py-4",
});

const cover = tv({
	base: "border-line aspect-[2/3] w-12 shrink-0 border",
});

const trackedCount = (total: number) =>
	`${total} ${total === 1 ? "work" : "works"}`;

const formatStatus = (status: WatchStatus) => status.replace("_", " ");

const metaLine = (entry: LibraryEntry) =>
	[
		formatStatus(entry.status),
		`${entry.watchedInstalments} / ${entry.totalInstalments}`,
		entry.rewatchCount > 0 ? `rewatch ×${entry.rewatchCount}` : undefined,
	]
		.filter((part) => part !== undefined)
		.join(" · ");

function Cover({ hue, src }: { hue: string; src: string | undefined }) {
	if (src === undefined) {
		return <div className={`${cover()} ${hue}`} />;
	}
	return <img alt="" className={`${cover()} object-cover`} src={src} />;
}

function Progress({ total, watched }: { total: number; watched: number }) {
	const percent = total === 0 ? 0 : Math.round((watched / total) * 100);
	const style = useMemo(() => ({ width: `${percent}%` }), [percent]);
	return (
		<div className="bg-ink/15 mt-2.5 h-[3px] max-w-[260px] overflow-hidden">
			<span className="bg-accent block h-full" style={style} />
		</div>
	);
}

function EntryBody({ entry, hue }: { entry: LibraryEntry; hue: string }) {
	return (
		<>
			<Cover hue={hue} src={imageUrl(entry.coverRef)} />
			<div className="min-w-0 flex-1">
				<h2 className="text-ink/95 truncate font-serif text-xl italic">
					{entry.title ?? UNTITLED}
				</h2>
				<p className="text-ink/50 mt-1 font-mono text-[11px] capitalize">
					{metaLine(entry)}
				</p>
				<Progress
					total={entry.totalInstalments}
					watched={entry.watchedInstalments}
				/>
			</div>
			<span className="text-ink/70 shrink-0 font-mono text-[13px]">
				{entry.personalRating === undefined
					? UNRATED
					: `${entry.personalRating}${OUT_OF_TEN}`}
			</span>
		</>
	);
}

function LibraryRow({ entry, hue }: { entry: LibraryEntry; hue: string }) {
	const continuityId = workPathId(entry.continuityId);
	if (continuityId === undefined) {
		throw new Error(`library: unpathable continuity ${entry.continuityId}`);
	}
	const params = useMemo(() => ({ continuityId }), [continuityId]);
	return (
		<li className={row()}>
			<Link params={params} to="/work/$continuityId">
				<EntryBody entry={entry} hue={hue} />
			</Link>
		</li>
	);
}

function StatsNavLink() {
	return (
		<Link to={STATS_PATH}>
			<span className="text-ink/50 hover:text-accent font-mono text-xs tracking-[0.1em] uppercase">
				{STATS_NAV}
			</span>
		</Link>
	);
}

function LibraryHeader() {
	return (
		<header className="flex items-center justify-between px-8 py-3.5">
			<nav className="flex items-center gap-5">
				<span className="text-accent font-mono text-xs font-medium tracking-[0.1em] uppercase">
					{BRAND}
				</span>
				<a
					className="text-ink/50 hover:text-accent font-mono text-xs tracking-[0.1em] uppercase"
					href={SEARCH_PATH}
				>
					{SEARCH_NAV}
				</a>
				<StatsNavLink />
			</nav>
			<div className="flex items-center gap-4">
				<BetterAuthHeader />
				<ThemeToggle />
			</div>
		</header>
	);
}

function EmptyLibrary() {
	return (
		<div className="border-line border-t px-8 py-16">
			<p className="text-ink/90 font-serif text-2xl italic">{EMPTY_HEADING}</p>
			<p className="text-ink/70 mt-3 max-w-[56ch] text-[15px] leading-relaxed">
				{EMPTY_BODY}
			</p>
			<p className="mt-6">
				<Link data-cta to={SEARCH_PATH}>
					{EMPTY_CTA}
				</Link>
			</p>
		</div>
	);
}

function EmptyFilter({ onClear }: { onClear: () => void }) {
	return (
		<div className="border-line border-t px-8 py-16">
			<p className="text-ink/90 font-serif text-2xl italic">
				{FILTER_EMPTY_HEADING}
			</p>
			<p className="text-ink/70 mt-3 max-w-[56ch] text-[15px] leading-relaxed">
				{FILTER_EMPTY_BODY}
			</p>
			<p className="mt-6">
				<button
					className="text-accent font-mono text-xs tracking-[0.1em] uppercase"
					onClick={onClear}
					type="button"
				>
					{CLEAR_FILTER}
				</button>
			</p>
		</div>
	);
}

function LibraryList({ entries }: { entries: readonly LibraryEntry[] }) {
	return (
		<ul>
			{entries.map((entry, index) => (
				<LibraryRow
					entry={entry}
					hue={posterHue(index)}
					key={entry.continuityId}
				/>
			))}
		</ul>
	);
}

interface LibraryBodyProps {
	entries: readonly LibraryEntry[];
	filteredEmpty: boolean;
	onClearFilter: () => void;
}

function LibraryBody({
	entries,
	filteredEmpty,
	onClearFilter,
}: LibraryBodyProps) {
	if (entries.length > 0) {
		return <LibraryList entries={entries} />;
	}
	if (filteredEmpty) {
		return <EmptyFilter onClear={onClearFilter} />;
	}
	return <EmptyLibrary />;
}

interface LibraryPageProps {
	entries: readonly LibraryEntry[];
	onSortChange: (sort: LibrarySort) => void;
	onStatusChange: (status: WatchStatus | undefined) => void;
	sort: LibrarySort;
	status: WatchStatus | undefined;
}

function LibraryPage({
	entries,
	onSortChange,
	onStatusChange,
	sort,
	status,
}: LibraryPageProps) {
	const filteredEmpty = entries.length === 0 && status !== undefined;
	const onClearFilter = useCallback(() => {
		onStatusChange(undefined);
	}, [onStatusChange]);
	return (
		<main className="mx-auto min-h-screen max-w-[1200px] pb-24">
			<LibraryHeader />
			<section className="px-8 pt-6 pb-7">
				<Label>{trackedCount(entries.length)}</Label>
				<h1 className="text-ink/95 mt-1 font-serif text-4xl italic">{TITLE}</h1>
				<p className="text-ink/60 mt-2 font-mono text-xs">{TAGLINE}</p>
				<LibraryControls
					onSortChange={onSortChange}
					onStatusChange={onStatusChange}
					sort={sort}
					status={status}
				/>
			</section>
			<LibraryBody
				entries={entries}
				filteredEmpty={filteredEmpty}
				onClearFilter={onClearFilter}
			/>
		</main>
	);
}

export { LibraryPage };
