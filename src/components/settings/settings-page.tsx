import { Link } from "@tanstack/react-router";
import { useCallback } from "react";

import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BetterAuthHeader } from "@/integrations/better-auth/header-user";
import { authClient } from "@/lib/auth-client";
import type { LibraryEntry } from "@/orpc/schema";

import { downloadLibraryExport, libraryExportJson } from "./library-export";

const BRAND = "mdbmap";
const TITLE = "Settings";
const TAGLINE = "Account and a copy of what you track.";
const SEARCH_NAV = "Search";
const SEARCH_PATH = "/search";
const LIBRARY_NAV = "Library";
const LIBRARY_PATH = "/library";
const EXPORT_LABEL = "Export library";
const EXPORT_HINT = "Downloads a JSON file of every tracked work.";
const ACCOUNT = "Account";
const UNSIGNED = "Sign in to manage your account.";
const NAME_LABEL = "Name";
const EMAIL_LABEL = "Email";

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

function SettingsHeader() {
	return (
		<header className="flex items-center justify-between px-8 py-3.5">
			<nav className="flex items-center gap-5">
				<HeaderNavLink label={BRAND} to="/" />
				<HeaderNavLink label={SEARCH_NAV} to={SEARCH_PATH} />
				<HeaderNavLink label={LIBRARY_NAV} to={LIBRARY_PATH} />
			</nav>
			<div className="flex items-center gap-4">
				<BetterAuthHeader />
				<ThemeToggle />
			</div>
		</header>
	);
}

function AccountCard({
	email,
	name,
}: {
	email: string | undefined;
	name: string | undefined;
}) {
	if (email === undefined && name === undefined) {
		return <p className="text-ink/70 mt-3 text-[15px]">{UNSIGNED}</p>;
	}
	return (
		<dl className="mt-4">
			<div className="border-line flex items-baseline justify-between border-t py-4">
				<dt className="text-ink/50 font-mono text-[11px] uppercase">
					{NAME_LABEL}
				</dt>
				<dd className="text-ink/90 font-serif text-xl italic">{name}</dd>
			</div>
			<div className="border-line flex items-baseline justify-between border-t py-4">
				<dt className="text-ink/50 font-mono text-[11px] uppercase">
					{EMAIL_LABEL}
				</dt>
				<dd className="text-ink/70 font-mono text-[13px]">{email}</dd>
			</div>
		</dl>
	);
}

function ExportButton({ entries }: { entries: readonly LibraryEntry[] }) {
	const onExport = useCallback(() => {
		downloadLibraryExport(libraryExportJson(entries, new Date().toISOString()));
	}, [entries]);
	return (
		<div className="border-line border-t px-8 py-8">
			<p className="text-ink/60 font-mono text-xs">{EXPORT_HINT}</p>
			<p className="mt-4">
				<button data-cta onClick={onExport} type="button">
					{EXPORT_LABEL}
				</button>
			</p>
		</div>
	);
}

function SettingsPage({ entries }: { entries: readonly LibraryEntry[] }) {
	const { data: session } = authClient.useSession();
	const user = session?.user;
	return (
		<main className="mx-auto min-h-screen max-w-[1200px] pb-24">
			<SettingsHeader />
			<section className="px-8 pt-6 pb-7">
				<Label>{ACCOUNT}</Label>
				<h1 className="text-ink/95 mt-1 font-serif text-4xl italic">{TITLE}</h1>
				<p className="text-ink/60 mt-2 font-mono text-xs">{TAGLINE}</p>
				<AccountCard email={user?.email} name={user?.name} />
			</section>
			<ExportButton entries={entries} />
		</main>
	);
}

export { SettingsPage };
