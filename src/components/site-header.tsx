import { Link } from "@tanstack/react-router";
import { tv } from "tailwind-variants";

import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BetterAuthHeader } from "@/integrations/better-auth/header-user";
import { authClient } from "@/lib/auth-client";

const BRAND = "mdbmap";
const SEARCH_NAV = "Search";
const LIBRARY_NAV = "Library";
const CALENDAR_NAV = "Calendar";
const STATS_NAV = "Stats";
const HOME_PATH = "/";
const SEARCH_PATH = "/search";
const LIBRARY_PATH = "/library";
const CALENDAR_PATH = "/calendar";
const STATS_PATH = "/stats";

const header = tv({
	base: "flex items-center justify-between",
	defaultVariants: {
		padded: true,
	},
	variants: {
		padded: {
			false: "",
			true: "px-8 py-3.5",
		},
	},
});

const brandClass =
	"text-accent font-mono text-xs font-medium tracking-[0.1em] uppercase";

const navItem = tv({
	base: "font-mono text-xs tracking-[0.1em] uppercase",
	variants: {
		active: {
			false: "text-ink/50 hover:text-accent",
			true: "text-accent",
		},
	},
});

type HeaderCurrent = "calendar" | "home" | "library" | "search" | "stats";
type HeaderTo =
	| typeof CALENDAR_PATH
	| typeof LIBRARY_PATH
	| typeof SEARCH_PATH
	| typeof STATS_PATH;

interface SiteHeaderProps {
	current?: HeaderCurrent;
	padded?: boolean;
}

function BrandLink({ active }: { active: boolean }) {
	return (
		<Link aria-current={active ? "page" : undefined} to={HOME_PATH}>
			<span className={brandClass}>{BRAND}</span>
		</Link>
	);
}

function HeaderLink({
	active,
	label,
	to,
}: {
	active: boolean;
	label: string;
	to: HeaderTo;
}) {
	return (
		<Link aria-current={active ? "page" : undefined} to={to}>
			<span className={navItem({ active })}>{label}</span>
		</Link>
	);
}

function LibraryNav({ current }: { current: HeaderCurrent | undefined }) {
	return (
		<>
			<HeaderLink
				active={current === "library"}
				label={LIBRARY_NAV}
				to={LIBRARY_PATH}
			/>
			<HeaderLink
				active={current === "calendar"}
				label={CALENDAR_NAV}
				to={CALENDAR_PATH}
			/>
			<HeaderLink
				active={current === "stats"}
				label={STATS_NAV}
				to={STATS_PATH}
			/>
		</>
	);
}

function SiteHeader({ current, padded = true }: SiteHeaderProps) {
	const { data: session, isPending } = authClient.useSession();
	const showLibrary = !isPending && session?.user !== undefined;
	return (
		<header className={header({ padded })}>
			<nav className="flex items-center gap-5">
				<BrandLink active={current === "home"} />
				<HeaderLink
					active={current === "search"}
					label={SEARCH_NAV}
					to={SEARCH_PATH}
				/>
				{showLibrary ? <LibraryNav current={current} /> : undefined}
			</nav>
			<div className="flex items-center gap-4">
				<BetterAuthHeader />
				<ThemeToggle />
			</div>
		</header>
	);
}

export { SiteHeader };
