import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { tv } from "tailwind-variants";

import { SiteHeader } from "@/components/site-header";
import { Label } from "@/components/ui/label";
import { imageUrl, posterHue } from "@/components/work/metadata/placeholders";
import { workPathId } from "@/engine/continuity/keys";
import type { HistoryEntry, HistoryListCursor } from "@/orpc/schema";

const TITLE = "History";
const TAGLINE = "Recently watched instalments, newest first.";
const EMPTY_HEADING = "Nothing watched yet.";
const EMPTY_BODY =
	"Tick an episode on a work you track. Newest watches are listed here.";
const EMPTY_CTA_LIBRARY = "Library";
const EMPTY_CTA_SEARCH = "Search catalogues";
const LOAD_MORE = "Load more";
const LIBRARY_PATH = "/library";
const SEARCH_PATH = "/search";
const UNTITLED = "Title unavailable";

const row = tv({
	base: "border-line hover:bg-ink/[0.04] border-t *:flex *:items-start *:gap-4 *:px-8 *:py-4",
});

const cover = tv({
	base: "border-line aspect-[2/3] w-12 shrink-0 border",
});

const padNumber = (value: number) => String(value).padStart(2, "0");

const instalmentLine = (entry: HistoryEntry) =>
	`${entry.partLabel} · ${padNumber(entry.number)} · ${entry.instalmentTitle}`;

const utcDay = (watchedAt: string) => watchedAt.slice(0, 10);

interface HistoryDay {
	date: string;
	entries: HistoryEntry[];
}

const groupByUtcDay = (entries: readonly HistoryEntry[]): HistoryDay[] => {
	const days: HistoryDay[] = [];
	for (const entry of entries) {
		const date = utcDay(entry.watchedAt);
		const current = days.at(-1);
		if (current?.date === date) {
			current.entries.push(entry);
			continue;
		}
		days.push({ date, entries: [entry] });
	}
	return days;
};

const rowKey = (entry: HistoryEntry) =>
	`${entry.continuityId}:${entry.watchedAt}:${entry.partLabel}:${String(entry.number)}`;

function Cover({ hue, src }: { hue: string; src: string | undefined }) {
	if (src === undefined) {
		return <div className={`${cover()} ${hue}`} />;
	}
	return <img alt="" className={`${cover()} object-cover`} src={src} />;
}

function EntryBody({ entry, hue }: { entry: HistoryEntry; hue: string }) {
	return (
		<>
			<Cover hue={hue} src={imageUrl(entry.coverRef)} />
			<div className="min-w-0 flex-1">
				<h2 className="text-ink/95 truncate font-serif text-xl italic">
					{entry.workTitle === "" ? UNTITLED : entry.workTitle}
				</h2>
				<p className="text-ink/50 mt-1 truncate font-mono text-[11px]">
					{instalmentLine(entry)}
				</p>
			</div>
		</>
	);
}

function HistoryRow({ entry, hue }: { entry: HistoryEntry; hue: string }) {
	const continuityId = workPathId(entry.continuityId);
	if (continuityId === undefined) {
		throw new Error(`history: unpathable continuity ${entry.continuityId}`);
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

function EmptyHistory() {
	return (
		<div className="border-line border-t px-8 py-16">
			<p className="text-ink/90 font-serif text-2xl italic">{EMPTY_HEADING}</p>
			<p className="text-ink/70 mt-3 max-w-[56ch] text-[15px] leading-relaxed">
				{EMPTY_BODY}
			</p>
			<p className="mt-6 flex gap-5">
				<Link to={LIBRARY_PATH}>{EMPTY_CTA_LIBRARY}</Link>
				<Link data-cta to={SEARCH_PATH}>
					{EMPTY_CTA_SEARCH}
				</Link>
			</p>
		</div>
	);
}

function DaySection({ day }: { day: HistoryDay }) {
	return (
		<section>
			<h2 className="text-ink/60 px-8 pt-6 font-mono text-xs">{day.date}</h2>
			<ul>
				{day.entries.map((entry, index) => (
					<HistoryRow
						entry={entry}
						hue={posterHue(index)}
						key={rowKey(entry)}
					/>
				))}
			</ul>
		</section>
	);
}

function HistoryList({ entries }: { entries: readonly HistoryEntry[] }) {
	return (
		<>
			{groupByUtcDay(entries).map((day) => (
				<DaySection day={day} key={day.date} />
			))}
		</>
	);
}

function LoadMore({
	loadingMore,
	onLoadMore,
}: {
	loadingMore: boolean;
	onLoadMore: () => void;
}) {
	return (
		<p className="px-8 py-6">
			<button
				className="text-accent font-mono text-xs tracking-[0.1em] uppercase"
				disabled={loadingMore}
				onClick={onLoadMore}
				type="button"
			>
				{LOAD_MORE}
			</button>
		</p>
	);
}

function HistoryPage({
	entries,
	loadingMore = false,
	nextCursor,
	onLoadMore,
}: {
	entries: readonly HistoryEntry[];
	loadingMore?: boolean;
	nextCursor: HistoryListCursor | undefined;
	onLoadMore: (() => void) | undefined;
}) {
	const empty = entries.length === 0 && nextCursor === undefined;
	return (
		<main className="mx-auto min-h-screen max-w-[1200px] pb-24">
			<SiteHeader current="history" />
			<section className="px-8 pt-6 pb-7">
				<Label>{TITLE}</Label>
				<h1 className="text-ink/95 mt-1 font-serif text-4xl italic">{TITLE}</h1>
				<p className="text-ink/60 mt-2 font-mono text-xs">{TAGLINE}</p>
			</section>
			{empty ? <EmptyHistory /> : undefined}
			{entries.length === 0 ? undefined : <HistoryList entries={entries} />}
			{nextCursor === undefined || onLoadMore === undefined ? undefined : (
				<LoadMore loadingMore={loadingMore} onLoadMore={onLoadMore} />
			)}
		</main>
	);
}

export { HistoryPage };
