import { Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { tv } from "tailwind-variants";

import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { workPathId } from "@/engine/continuity/keys";
import { BetterAuthHeader } from "@/integrations/better-auth/header-user";
import type { AiringDay, AiringEpisode } from "@/orpc/airing";

const BRAND = "mdbmap";
const TITLE = "Calendar";
const TAGLINE = "Unwatched instalments airing in the next two weeks.";
const EMPTY_HEADING = "Nothing airing soon.";
const EMPTY_BODY =
	"Watching, rewatching, and on-hold works show up here when the next instalment has an air date.";
const SEARCH_NAV = "Search";
const LIBRARY_NAV = "Library";
const CALENDAR_NAV = "Calendar";
const HISTORY_NAV = "History";
const SEARCH_PATH = "/search";
const LIBRARY_PATH = "/library";
const HISTORY_PATH = "/history";
const HOME_PATH = "/";

const navItem = tv({
	base: "font-mono text-xs tracking-[0.1em] uppercase",
	compoundVariants: [
		{
			brand: true,
			class: "text-accent font-medium",
		},
	],
	defaultVariants: {
		active: false,
		brand: false,
	},
	variants: {
		active: {
			false: "text-ink/50 hover:text-accent",
			true: "text-accent",
		},
		brand: {
			false: "",
			true: "",
		},
	},
});

const row = tv({
	base: "border-line hover:bg-ink/[0.04] border-t *:flex *:flex-col *:gap-1 *:px-8 *:py-4",
});

const padNumber = (value: number) => String(value).padStart(2, "0");

const episodeLine = (item: AiringEpisode) =>
	`${item.workTitle} · ${item.partLabel} · ${padNumber(item.number)} · ${item.title}`;

const episodeKey = (item: AiringEpisode) =>
	`${item.continuityId}:${item.partLabel}:${item.number}`;

function HeaderNavLink({
	active,
	brand,
	label,
	to,
}: {
	active: boolean;
	brand?: boolean;
	label: string;
	to:
		| typeof HOME_PATH
		| typeof HISTORY_PATH
		| typeof LIBRARY_PATH
		| typeof SEARCH_PATH;
}) {
	return (
		<Link aria-current={active ? "page" : undefined} to={to}>
			<span className={navItem({ active, brand })}>{label}</span>
		</Link>
	);
}

function HeaderNav() {
	return (
		<nav className="flex items-center gap-5">
			<HeaderNavLink active={false} brand label={BRAND} to={HOME_PATH} />
			<HeaderNavLink active={false} label={SEARCH_NAV} to={SEARCH_PATH} />
			<HeaderNavLink active={false} label={LIBRARY_NAV} to={LIBRARY_PATH} />
			<span aria-current="page" className={navItem({ active: true })}>
				{CALENDAR_NAV}
			</span>
			<HeaderNavLink active={false} label={HISTORY_NAV} to={HISTORY_PATH} />
		</nav>
	);
}

function HeaderTools() {
	return (
		<div className="flex items-center gap-4">
			<BetterAuthHeader />
			<ThemeToggle />
		</div>
	);
}

function CalendarHeader() {
	return (
		<header className="flex items-center justify-between px-8 py-3.5">
			<HeaderNav />
			<HeaderTools />
		</header>
	);
}

function PageIntro() {
	return (
		<section className="px-8 pt-6 pb-7">
			<Label>{CALENDAR_NAV}</Label>
			<h1 className="text-ink/95 mt-1 font-serif text-4xl italic">{TITLE}</h1>
			<p className="text-ink/60 mt-2 font-mono text-xs">{TAGLINE}</p>
		</section>
	);
}

function EmptyCalendar() {
	return (
		<div className="border-line border-t px-8 py-16">
			<p className="text-ink/90 font-serif text-2xl italic">{EMPTY_HEADING}</p>
			<p className="text-ink/70 mt-3 max-w-[56ch] text-[15px] leading-relaxed">
				{EMPTY_BODY}
			</p>
		</div>
	);
}

function RowBody({ item }: { item: AiringEpisode }) {
	return (
		<p className="text-ink/90 truncate font-mono text-[13px]">
			{episodeLine(item)}
		</p>
	);
}

function EpisodeLink({ item }: { item: AiringEpisode }) {
	const continuityId = workPathId(item.continuityId);
	if (continuityId === undefined) {
		throw new Error(`calendar: unpathable continuity ${item.continuityId}`);
	}
	const params = useMemo(() => ({ continuityId }), [continuityId]);
	return (
		<Link params={params} to="/work/$continuityId">
			<RowBody item={item} />
		</Link>
	);
}

function EpisodeRow({ item }: { item: AiringEpisode }) {
	return (
		<li className={row()}>
			<EpisodeLink item={item} />
		</li>
	);
}

function EpisodeList({ episodes }: { episodes: readonly AiringEpisode[] }) {
	return (
		<ul>
			{episodes.map((item) => (
				<EpisodeRow item={item} key={episodeKey(item)} />
			))}
		</ul>
	);
}

function DaySection({ day }: { day: AiringDay }) {
	return (
		<section>
			<h2 className="text-ink/60 px-8 pt-6 font-mono text-xs">{day.date}</h2>
			<EpisodeList episodes={day.episodes} />
		</section>
	);
}

function CalendarPage({ days }: { days: readonly AiringDay[] }) {
	return (
		<main className="mx-auto min-h-screen max-w-[1200px] pb-24">
			<CalendarHeader />
			<PageIntro />
			{days.length === 0 ? (
				<EmptyCalendar />
			) : (
				days.map((day) => <DaySection day={day} key={day.date} />)
			)}
		</main>
	);
}

export { CalendarPage };
