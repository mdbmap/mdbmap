import { Link } from "@tanstack/react-router";

import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import type { WatchStatus } from "@/db/schema";
import { watchStatuses } from "@/db/schema";
import { BetterAuthHeader } from "@/integrations/better-auth/header-user";
import type { LibraryEntry } from "@/orpc/schema";

import { formatHoursWatchedValue, mediaKinds, summarise } from "./summarise";
import type { LibraryStats } from "./summarise";

const BRAND = "mdbmap";
const TITLE = "Stats";
const TAGLINE = "A snapshot of what you track.";
const EMPTY_HEADING = "Nothing tracked yet.";
const EMPTY_BODY =
	"Open a work and set a watch status or tick an episode. A snapshot shows up here the moment you do.";
const EMPTY_CTA = "Search catalogues";
const SEARCH_NAV = "Search";
const SEARCH_PATH = "/search";
const LIBRARY_NAV = "Library";
const LIBRARY_PATH = "/library";
const HISTORY_NAV = "History";
const HISTORY_PATH = "/history";
const UNRATED = "—";
const OUT_OF_TEN = "/10";
const RATED = "rated";
const INSTALMENTS = "instalments";

const trackedCount = (total: number) =>
	`${total} ${total === 1 ? "work" : "works"}`;

const formatStatus = (status: WatchStatus) => status.replaceAll("_", " ");

const formatMean = (mean: number, rated: number) =>
	`${mean.toFixed(1)}${OUT_OF_TEN} · ${rated} ${RATED}`;

const formatInstalments = (watched: number, total: number) =>
	`${watched} / ${total}`;

const formatRewatch = (count: number) => `×${count}`;

const kindLabels: Record<(typeof mediaKinds)[number], string> = {
	anime: "Anime",
	film: "Film",
	tv: "TV",
};

const navClass =
	"text-ink/50 hover:text-accent font-mono text-xs tracking-[0.1em] uppercase";
const brandClass =
	"text-accent font-mono text-xs font-medium tracking-[0.1em] uppercase";

function HeaderNavLink({
	label,
	to,
}: {
	label: string;
	to: "/" | typeof LIBRARY_PATH | typeof SEARCH_PATH;
}) {
	return (
		<Link to={to}>
			<span className={to === "/" ? brandClass : navClass}>{label}</span>
		</Link>
	);
}

function HistoryNavLink() {
	return (
		<a href={HISTORY_PATH}>
			<span className={navClass}>{HISTORY_NAV}</span>
		</a>
	);
}

function StatsHeader() {
	return (
		<header className="flex items-center justify-between px-8 py-3.5">
			<nav className="flex items-center gap-5">
				<HeaderNavLink label={BRAND} to="/" />
				<HeaderNavLink label={SEARCH_NAV} to={SEARCH_PATH} />
				<HeaderNavLink label={LIBRARY_NAV} to={LIBRARY_PATH} />
				<HistoryNavLink />
			</nav>
			<div className="flex items-center gap-4">
				<BetterAuthHeader />
				<ThemeToggle />
			</div>
		</header>
	);
}

function EmptyStats() {
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

function CountRow({ label, value }: { label: string; value: string }) {
	return (
		<li className="border-line flex items-baseline justify-between border-t px-8 py-4">
			<span className="text-ink/90 font-serif text-xl capitalize italic">
				{label}
			</span>
			<span className="text-ink/70 shrink-0 font-mono text-[13px]">
				{value}
			</span>
		</li>
	);
}

function StatusRows({ stats }: { stats: LibraryStats }) {
	return (
		<>
			{watchStatuses.map((status) => (
				<CountRow
					key={status}
					label={formatStatus(status)}
					value={String(stats.statusCounts[status])}
				/>
			))}
		</>
	);
}

function KindRows({ stats }: { stats: LibraryStats }) {
	return (
		<>
			{mediaKinds.map((kind) => (
				<CountRow
					key={kind}
					label={kindLabels[kind]}
					value={String(stats.kindCounts[kind])}
				/>
			))}
		</>
	);
}

function SnapshotRows({ stats }: { stats: LibraryStats }) {
	const rating =
		stats.meanRating === undefined
			? UNRATED
			: formatMean(stats.meanRating, stats.ratedCount);
	return (
		<>
			<StatusRows stats={stats} />
			<KindRows stats={stats} />
			<CountRow label="personal rating" value={rating} />
			<CountRow
				label={INSTALMENTS}
				value={formatInstalments(
					stats.watchedInstalments,
					stats.totalInstalments,
				)}
			/>
			<CountRow
				label="hours watched"
				value={formatHoursWatchedValue(
					stats.watchedMinutes,
					stats.omittedRuntime,
				)}
			/>
			<CountRow label="rewatch" value={formatRewatch(stats.rewatchCount)} />
		</>
	);
}

function StatsPage({ entries }: { entries: readonly LibraryEntry[] }) {
	const stats = summarise(entries);
	return (
		<main className="mx-auto min-h-screen max-w-[1200px] pb-24">
			<StatsHeader />
			<section className="px-8 pt-6 pb-7">
				<Label>{trackedCount(stats.totalWorks)}</Label>
				<h1 className="text-ink/95 mt-1 font-serif text-4xl italic">{TITLE}</h1>
				<p className="text-ink/60 mt-2 font-mono text-xs">{TAGLINE}</p>
			</section>
			{entries.length === 0 ? (
				<EmptyStats />
			) : (
				<ul>
					<SnapshotRows stats={stats} />
				</ul>
			)}
		</main>
	);
}

export { StatsPage };
