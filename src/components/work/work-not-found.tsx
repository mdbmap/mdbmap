import { Link } from "@tanstack/react-router";

import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BetterAuthHeader } from "@/integrations/better-auth/header-user";

const BRAND = "mdbmap";
const HEADING = "This work is not in the map yet.";
const SEARCH_CTA = "Search catalogues";
const SEARCH_NAV = "Search";
const SEARCH_PATH = "/search";

function WorkHeader() {
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
			</nav>
			<div className="flex items-center gap-4">
				<BetterAuthHeader />
				<ThemeToggle />
			</div>
		</header>
	);
}

function MissingWork() {
	return (
		<div className="border-line border-t px-8 py-16">
			<p className="text-ink/90 font-serif text-2xl italic">{HEADING}</p>
			<p className="mt-6">
				<Link data-cta to={SEARCH_PATH}>
					{SEARCH_CTA}
				</Link>
			</p>
		</div>
	);
}

export function WorkNotFound() {
	return (
		<main className="mx-auto min-h-screen max-w-[1200px] pb-24">
			<WorkHeader />
			<MissingWork />
		</main>
	);
}
