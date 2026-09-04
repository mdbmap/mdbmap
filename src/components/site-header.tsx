import { Link } from "@tanstack/react-router";
import { tv } from "tailwind-variants";

import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BetterAuthHeader } from "@/integrations/better-auth/header-user";
import { authClient } from "@/lib/auth-client";

const BRAND = "mdbmap";
const SEARCH_NAV = "Search";
const LIBRARY_NAV = "Library";
const HOME_PATH = "/";
const SEARCH_PATH = "/search";
const LIBRARY_PATH = "/library";

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

const navItem = tv({
	base: "font-mono text-xs tracking-[0.1em] uppercase",
	variants: {
		active: {
			false: "text-ink/50 hover:text-accent",
			true: "text-accent",
		},
	},
});

type HeaderCurrent = "home" | "library" | "search";
type HeaderTo = typeof HOME_PATH | typeof LIBRARY_PATH | typeof SEARCH_PATH;

interface SiteHeaderProps {
	current?: HeaderCurrent;
	padded?: boolean;
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
		<Link to={to}>
			<span className={navItem({ active })}>{label}</span>
		</Link>
	);
}

function SiteHeader({ current, padded = true }: SiteHeaderProps) {
	const { data: session, isPending } = authClient.useSession();
	const showLibrary = !isPending && session?.user !== undefined;
	return (
		<header className={header({ padded })}>
			<nav className="flex items-center gap-5">
				<HeaderLink active={current === "home"} label={BRAND} to={HOME_PATH} />
				<HeaderLink
					active={current === "search"}
					label={SEARCH_NAV}
					to={SEARCH_PATH}
				/>
				{showLibrary ? (
					<HeaderLink
						active={current === "library"}
						label={LIBRARY_NAV}
						to={LIBRARY_PATH}
					/>
				) : undefined}
			</nav>
			<div className="flex items-center gap-4">
				<BetterAuthHeader />
				<ThemeToggle />
			</div>
		</header>
	);
}

export { SiteHeader };
