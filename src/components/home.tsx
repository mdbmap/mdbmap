import { useState } from "react";

import { Label } from "@/components/ui/label";
import { Section } from "@/components/ui/section";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { AuthDialog } from "@/integrations/better-auth/auth-dialog";
import { BetterAuthHeader } from "@/integrations/better-auth/header-user";
import { authClient } from "@/lib/auth-client";

const BRAND = "mdbmap";
const HEADLINE = "Television, film and anime, tracked as one story.";
const SUPPORT =
	"mdbmap matches instalments across catalogues, so your progress and ratings stay with the work itself rather than whichever service happened to list it.";
const LIBRARY_PATH = "/library";
const SEARCH_NAV = "Search";
const SEARCH_PATH = "/search";

const COPY = {
	library: "Open your library",
	signIn: "Sign in to start tracking",
	tracks: "Tracks",
} as const;

const tracked = [
	{ detail: "seasons and episodes", kind: "Television" },
	{ detail: "standalone and grouped instalments", kind: "Film" },
	{ detail: "cours, specials and OVAs", kind: "Anime" },
] as const;

function Header() {
	return (
		<header className="flex items-center justify-between">
			<a
				className="text-ink/50 hover:text-accent font-mono text-xs tracking-[0.1em] uppercase"
				href={SEARCH_PATH}
			>
				{SEARCH_NAV}
			</a>
			<div className="flex items-center gap-4">
				<BetterAuthHeader />
				<ThemeToggle />
			</div>
		</header>
	);
}

function HeroCta({
	onSigninOpenChange,
	signinOpen,
}: {
	onSigninOpenChange?: (open: boolean) => void;
	signinOpen: boolean;
}) {
	const { data: session, isPending } = authClient.useSession();
	const [sessionReady, setSessionReady] = useState(!isPending);
	if (!isPending && !sessionReady) {
		setSessionReady(true);
	}

	if (!sessionReady) {
		return (
			<div
				aria-hidden
				className="border-line bg-ink/10 h-[38px] w-56 animate-pulse border"
			/>
		);
	}

	if (session?.user === undefined) {
		if (onSigninOpenChange === undefined) {
			return <AuthDialog label={COPY.signIn} variant="hero" />;
		}
		return (
			<AuthDialog
				isOpen={signinOpen}
				label={COPY.signIn}
				onOpenChange={onSigninOpenChange}
				variant="hero"
			/>
		);
	}

	return (
		<a data-cta href={LIBRARY_PATH}>
			{COPY.library}
		</a>
	);
}

function Hero({
	onSigninOpenChange,
	signinOpen,
}: {
	onSigninOpenChange?: (open: boolean) => void;
	signinOpen: boolean;
}) {
	return (
		<section className="flex min-h-[60vh] flex-col justify-center">
			<h1 className="text-accent font-mono text-5xl font-medium tracking-[-0.02em] sm:text-6xl">
				{BRAND}
			</h1>
			<p className="text-ink/95 mt-7 max-w-[22ch] font-serif text-4xl leading-tight italic sm:text-5xl">
				{HEADLINE}
			</p>
			<p className="text-ink/70 mt-5 max-w-[58ch] text-[15px] leading-relaxed text-pretty">
				{SUPPORT}
			</p>
			<div className="mt-10 flex items-center gap-5">
				{onSigninOpenChange === undefined ? (
					<HeroCta signinOpen={signinOpen} />
				) : (
					<HeroCta
						onSigninOpenChange={onSigninOpenChange}
						signinOpen={signinOpen}
					/>
				)}
			</div>
		</section>
	);
}

function TrackRow({ detail, kind }: { detail: string; kind: string }) {
	return (
		<div className="border-line flex items-baseline justify-between border-b pb-3">
			<span className="text-ink/90 font-serif text-xl">{kind}</span>
			<span className="text-ink/45 font-mono text-[11px]">{detail}</span>
		</div>
	);
}

function TracksSection() {
	return (
		<Section>
			<Label>{COPY.tracks}</Label>
			<div className="mt-4 flex flex-col gap-3">
				{tracked.map((row) => (
					<TrackRow detail={row.detail} key={row.kind} kind={row.kind} />
				))}
			</div>
		</Section>
	);
}

export function Home({
	onSigninOpenChange,
	signinOpen = false,
}: {
	onSigninOpenChange?: (open: boolean) => void;
	signinOpen?: boolean;
}) {
	return (
		<main className="mx-auto flex min-h-screen max-w-3xl flex-col gap-14 px-8 py-14">
			<Header />
			{onSigninOpenChange === undefined ? (
				<Hero signinOpen={signinOpen} />
			) : (
				<Hero onSigninOpenChange={onSigninOpenChange} signinOpen={signinOpen} />
			)}
			<TracksSection />
		</main>
	);
}
