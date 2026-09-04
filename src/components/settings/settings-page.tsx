import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useCallback } from "react";
import { tv } from "tailwind-variants";

import { Label } from "@/components/ui/label";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { BetterAuthHeader } from "@/integrations/better-auth/header-user";
import { orpc } from "@/orpc/client";

import { SyncTargetsActions } from "./sync-targets-actions.tsx";

const BRAND = "mdbmap";
const TITLE = "Settings";
const TAGLINE = "Manage sync billing for this account.";
const LIBRARY_NAV = "Library";
const SEARCH_NAV = "Search";
const SYNC_HEADING = "Paid sync";
const SYNC_BODY =
	"Outbound library sync is a paid feature. Checkout and billing are handled by Stripe.";
const STATUS_ACTIVE = "Entitlement active.";
const STATUS_INACTIVE = "Entitlement inactive.";
const CHECKOUT_LABEL = "Start checkout";
const PORTAL_LABEL = "Manage billing";
const CHECKOUT_PENDING = "Redirecting to Checkout…";
const PORTAL_PENDING = "Redirecting to Customer Portal…";

const page = tv({
	base: "bg-paper text-ink mx-auto flex min-h-dvh max-w-3xl flex-col gap-10 px-5 py-8",
});

const brandMark = tv({
	base: "font-display text-ink text-2xl tracking-tight [&_a]:text-inherit [&_a]:no-underline",
});

const navRow = tv({
	base: "text-ink/50 [&_a]:hover:text-accent flex items-center gap-3 font-mono text-xs [&_a]:no-underline",
});

const actionRow = tv({
	base: "[&_button]:border-line [&_button]:text-ink [&_button]:hover:border-accent [&_button]:hover:text-accent flex flex-wrap gap-3 [&_button]:inline-flex [&_button]:cursor-pointer [&_button]:items-center [&_button]:border [&_button]:bg-transparent [&_button]:px-3 [&_button]:py-2 [&_button]:font-mono [&_button]:text-xs [&_button]:disabled:cursor-wait [&_button]:disabled:opacity-50",
});

const errorText = tv({
	base: "text-accent font-mono text-xs",
});

function BrandLink() {
	return (
		<div className={brandMark()}>
			<Link to="/">{BRAND}</Link>
		</div>
	);
}

function SettingsNav() {
	return (
		<nav className={navRow()}>
			<Link to="/library">{LIBRARY_NAV}</Link>
			<Link to="/search">{SEARCH_NAV}</Link>
		</nav>
	);
}

function SettingsTools() {
	return (
		<div className="flex items-center gap-3">
			<ThemeToggle />
			<BetterAuthHeader />
		</div>
	);
}

function SettingsHeader() {
	return (
		<header className="flex items-start justify-between gap-4">
			<div className="flex flex-col gap-3">
				<BrandLink />
				<SettingsNav />
			</div>
			<SettingsTools />
		</header>
	);
}

function SettingsIntro() {
	return (
		<section className="flex flex-col gap-3">
			<Label>{TITLE}</Label>
			<p className="text-ink/60 max-w-prose text-sm">{TAGLINE}</p>
		</section>
	);
}

function BillingCopy({ entitlement }: { entitlement: "active" | "inactive" }) {
	return (
		<>
			<h2 className="font-display text-xl tracking-tight">{SYNC_HEADING}</h2>
			<p className="text-ink/60 max-w-prose text-sm">{SYNC_BODY}</p>
			<p className="font-mono text-xs">
				{entitlement === "active" ? STATUS_ACTIVE : STATUS_INACTIVE}
			</p>
		</>
	);
}

function BillingButtons({
	checkoutPending,
	hasCustomer,
	onCheckout,
	onPortal,
	portalPending,
}: {
	checkoutPending: boolean;
	hasCustomer: boolean;
	onCheckout: () => void;
	onPortal: () => void;
	portalPending: boolean;
}) {
	return (
		<div className={actionRow()}>
			<button disabled={checkoutPending} onClick={onCheckout} type="button">
				{checkoutPending ? CHECKOUT_PENDING : CHECKOUT_LABEL}
			</button>
			<button
				disabled={portalPending || !hasCustomer}
				onClick={onPortal}
				type="button"
			>
				{portalPending ? PORTAL_PENDING : PORTAL_LABEL}
			</button>
		</div>
	);
}

function BillingActions() {
	const statusQuery = useQuery(orpc.billing.status.queryOptions());
	const checkout = useMutation(
		orpc.billing.createCheckout.mutationOptions({
			onSuccess: ({ url }) => {
				globalThis.location.assign(url);
			},
		}),
	);
	const portal = useMutation(
		orpc.billing.createPortal.mutationOptions({
			onSuccess: ({ url }) => {
				globalThis.location.assign(url);
			},
		}),
	);

	const startCheckout = useCallback(() => {
		checkout.mutate({});
	}, [checkout]);

	const openPortal = useCallback(() => {
		portal.mutate({});
	}, [portal]);

	const entitlement = statusQuery.data?.status ?? "inactive";
	const hasCustomer = statusQuery.data?.hasCustomer ?? false;
	const checkoutMessage = checkout.error?.message;
	const portalMessage = portal.error?.message;

	return (
		<section className="border-line flex flex-col gap-4 border-t pt-6">
			<BillingCopy entitlement={entitlement} />
			<BillingButtons
				checkoutPending={checkout.isPending}
				hasCustomer={hasCustomer}
				onCheckout={startCheckout}
				onPortal={openPortal}
				portalPending={portal.isPending}
			/>
			{checkoutMessage === undefined ? undefined : (
				<p className={errorText()}>{checkoutMessage}</p>
			)}
			{portalMessage === undefined ? undefined : (
				<p className={errorText()}>{portalMessage}</p>
			)}
		</section>
	);
}

function SettingsPage() {
	const statusQuery = useQuery(orpc.billing.status.queryOptions());
	const entitlement = statusQuery.data?.status ?? "inactive";

	return (
		<main className={page()}>
			<SettingsHeader />
			<SettingsIntro />
			<BillingActions />
			<SyncTargetsActions entitlement={entitlement} />
		</main>
	);
}

export { SettingsPage };
