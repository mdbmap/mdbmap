import type { ChangeEvent, MouseEvent, SubmitEvent } from "react";
import { useCallback } from "react";
import { tv } from "tailwind-variants";

import type { SyncAccountProvider } from "@/db/schema";
import type { SyncAccountPublic } from "@/lib/sync-accounts";

const TARGETS_HEADING = "Sync targets";
const TARGETS_BODY =
	"Connect AniList or MAL to push watch status, progress, and ratings.";
const LOCKED_COPY =
	"Sync targets unlock with an active entitlement. Use checkout above to upgrade.";
const CONNECT_LABEL = "Connect";
const DISCONNECT_LABEL = "Disconnect";
const SYNC_NOW_LABEL = "Sync now";
const SYNC_NOW_PENDING = "Syncing…";
const TOKEN_PLACEHOLDER = "Access token";
const NOT_LINKED = "Not connected";
const LAST_SUCCESS = "Last success";
const LAST_ERROR = "Last error";
const NONE = "—";

const CONNECTABLE_PROVIDERS = [
	"anilist",
	"mal",
] as const satisfies readonly SyncAccountProvider[];

const providerCard = tv({
	base: "[&_button]:border-line [&_button]:text-ink [&_button]:hover:border-accent [&_button]:hover:text-accent [&_input]:border-line [&_input]:bg-paper [&_input]:text-ink flex flex-col gap-2 [&_button]:inline-flex [&_button]:cursor-pointer [&_button]:items-center [&_button]:border [&_button]:bg-transparent [&_button]:px-3 [&_button]:py-2 [&_button]:font-mono [&_button]:text-xs [&_button]:disabled:cursor-wait [&_button]:disabled:opacity-50 [&_input]:min-w-[12rem] [&_input]:border [&_input]:px-2 [&_input]:py-1.5 [&_input]:font-mono [&_input]:text-xs",
});

const errorText = tv({
	base: "text-accent font-mono text-xs",
});

const providerLabel = (
	provider: (typeof CONNECTABLE_PROVIDERS)[number],
): string => {
	switch (provider) {
		case "anilist": {
			return "AniList";
		}
		case "mal": {
			return "MyAnimeList";
		}
	}
};

const isConnectableProvider = (
	value: string,
): value is (typeof CONNECTABLE_PROVIDERS)[number] =>
	(CONNECTABLE_PROVIDERS as readonly string[]).includes(value);

interface SyncTargetsPanelProps {
	readonly accounts: readonly SyncAccountPublic[];
	readonly connectPendingProvider: SyncAccountProvider | undefined;
	readonly disconnectPendingProvider: SyncAccountProvider | undefined;
	readonly entitlement: "active" | "inactive";
	readonly message: string | undefined;
	readonly onConnect: (
		provider: SyncAccountProvider,
		accessToken: string,
	) => void;
	readonly onDisconnect: (provider: SyncAccountProvider) => void;
	readonly onSyncNow: () => void;
	readonly onTokenChange: (
		provider: SyncAccountProvider,
		value: string,
	) => void;
	readonly syncPending: boolean;
	readonly tokens: Readonly<Partial<Record<SyncAccountProvider, string>>>;
}

function accountOf(
	accounts: readonly SyncAccountPublic[],
	provider: SyncAccountProvider,
): SyncAccountPublic | undefined {
	return accounts.find((account) => account.provider === provider);
}

function LockedTargets() {
	return (
		<section
			aria-label={TARGETS_HEADING}
			className="border-line flex flex-col gap-3 border-t pt-6"
			data-sync-locked=""
		>
			<h2 className="font-display text-xl tracking-tight">{TARGETS_HEADING}</h2>
			<p className="text-ink/60 max-w-prose text-sm">{LOCKED_COPY}</p>
		</section>
	);
}

function LinkedTargetSummary({
	account,
}: {
	readonly account: SyncAccountPublic;
}) {
	return (
		<>
			<p className="text-ink/50 font-mono text-xs">
				{`Linked ${account.linkedAt.toISOString()}`}
			</p>
			<p className="font-mono text-xs">
				{`${LAST_SUCCESS}: ${account.cursor ?? NONE}`}
			</p>
			<p className="font-mono text-xs">
				{`${LAST_ERROR}: ${account.lastError ?? NONE}`}
			</p>
		</>
	);
}

function LinkedProviderCard({
	account,
	disconnectPending,
	onDisconnectClick,
	provider,
}: {
	readonly account: SyncAccountPublic;
	readonly disconnectPending: boolean;
	readonly onDisconnectClick: (event: MouseEvent<HTMLButtonElement>) => void;
	readonly provider: (typeof CONNECTABLE_PROVIDERS)[number];
}) {
	return (
		<div className={providerCard()} data-sync-provider={provider}>
			<h3 className="font-mono text-sm">{providerLabel(provider)}</h3>
			<LinkedTargetSummary account={account} />
			<button
				disabled={disconnectPending}
				name={provider}
				onClick={onDisconnectClick}
				type="button"
			>
				{DISCONNECT_LABEL}
			</button>
		</div>
	);
}

function ConnectProviderForm({
	connectPending,
	onConnectSubmit,
	onTokenInput,
	provider,
	token,
}: {
	readonly connectPending: boolean;
	readonly onConnectSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
	readonly onTokenInput: (event: ChangeEvent<HTMLInputElement>) => void;
	readonly provider: (typeof CONNECTABLE_PROVIDERS)[number];
	readonly token: string;
}) {
	const label = providerLabel(provider);
	return (
		<form
			className={providerCard()}
			data-sync-provider={provider}
			name={provider}
			onSubmit={onConnectSubmit}
		>
			<h3 className="font-mono text-sm">{label}</h3>
			<p className="text-ink/50 font-mono text-xs">{NOT_LINKED}</p>
			<input
				aria-label={`${label} ${TOKEN_PLACEHOLDER}`}
				autoComplete="off"
				name={provider}
				onChange={onTokenInput}
				placeholder={TOKEN_PLACEHOLDER}
				type="password"
				value={token}
			/>
			<button disabled={connectPending || token.trim() === ""} type="submit">
				{CONNECT_LABEL}
			</button>
		</form>
	);
}

function ProviderList({
	accounts,
	connectPendingProvider,
	disconnectPendingProvider,
	onConnectSubmit,
	onDisconnectClick,
	onTokenInput,
	tokens,
}: {
	readonly accounts: readonly SyncAccountPublic[];
	readonly connectPendingProvider: SyncAccountProvider | undefined;
	readonly disconnectPendingProvider: SyncAccountProvider | undefined;
	readonly onConnectSubmit: (event: SubmitEvent<HTMLFormElement>) => void;
	readonly onDisconnectClick: (event: MouseEvent<HTMLButtonElement>) => void;
	readonly onTokenInput: (event: ChangeEvent<HTMLInputElement>) => void;
	readonly tokens: Readonly<Partial<Record<SyncAccountProvider, string>>>;
}) {
	return (
		<>
			{CONNECTABLE_PROVIDERS.map((provider) => {
				const account = accountOf(accounts, provider);
				if (account !== undefined) {
					return (
						<LinkedProviderCard
							account={account}
							disconnectPending={disconnectPendingProvider === provider}
							key={provider}
							onDisconnectClick={onDisconnectClick}
							provider={provider}
						/>
					);
				}
				return (
					<ConnectProviderForm
						connectPending={connectPendingProvider === provider}
						key={provider}
						onConnectSubmit={onConnectSubmit}
						onTokenInput={onTokenInput}
						provider={provider}
						token={tokens[provider] ?? ""}
					/>
				);
			})}
		</>
	);
}

function EntitledTargets({
	accounts,
	connectPendingProvider,
	disconnectPendingProvider,
	message,
	onConnect,
	onDisconnect,
	onSyncNow,
	onTokenChange,
	syncPending,
	tokens,
}: Omit<SyncTargetsPanelProps, "entitlement">) {
	const onTokenInput = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const { name, value } = event.currentTarget;
			if (isConnectableProvider(name)) {
				onTokenChange(name, value);
			}
		},
		[onTokenChange],
	);

	const onConnectSubmit = useCallback(
		(event: SubmitEvent<HTMLFormElement>) => {
			event.preventDefault();
			const provider = event.currentTarget.name;
			if (!isConnectableProvider(provider)) {
				return;
			}
			onConnect(provider, tokens[provider] ?? "");
		},
		[onConnect, tokens],
	);

	const onDisconnectClick = useCallback(
		(event: MouseEvent<HTMLButtonElement>) => {
			const provider = event.currentTarget.name;
			if (isConnectableProvider(provider)) {
				onDisconnect(provider);
			}
		},
		[onDisconnect],
	);

	return (
		<section
			aria-label={TARGETS_HEADING}
			className="border-line flex flex-col gap-5 border-t pt-6"
			data-sync-entitled=""
		>
			<h2 className="font-display text-xl tracking-tight">{TARGETS_HEADING}</h2>
			<p className="text-ink/60 max-w-prose text-sm">{TARGETS_BODY}</p>
			<ProviderList
				accounts={accounts}
				connectPendingProvider={connectPendingProvider}
				disconnectPendingProvider={disconnectPendingProvider}
				onConnectSubmit={onConnectSubmit}
				onDisconnectClick={onDisconnectClick}
				onTokenInput={onTokenInput}
				tokens={tokens}
			/>
			<button
				className={providerCard()}
				disabled={syncPending}
				onClick={onSyncNow}
				type="button"
			>
				{syncPending ? SYNC_NOW_PENDING : SYNC_NOW_LABEL}
			</button>
			{message === undefined ? undefined : (
				<p className={errorText()}>{message}</p>
			)}
		</section>
	);
}

function SyncTargetsPanel({
	accounts,
	connectPendingProvider,
	disconnectPendingProvider,
	entitlement,
	message,
	onConnect,
	onDisconnect,
	onSyncNow,
	onTokenChange,
	syncPending,
	tokens,
}: SyncTargetsPanelProps) {
	if (entitlement === "inactive") {
		return <LockedTargets />;
	}
	return (
		<EntitledTargets
			accounts={accounts}
			connectPendingProvider={connectPendingProvider}
			disconnectPendingProvider={disconnectPendingProvider}
			message={message}
			onConnect={onConnect}
			onDisconnect={onDisconnect}
			onSyncNow={onSyncNow}
			onTokenChange={onTokenChange}
			syncPending={syncPending}
			tokens={tokens}
		/>
	);
}

export { SyncTargetsPanel };
export type { SyncTargetsPanelProps };
