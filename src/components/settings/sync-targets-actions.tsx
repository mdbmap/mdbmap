import { SyncTargetsPanel } from "./sync-targets.tsx";
import { useSyncTargetsActions } from "./use-sync-targets-actions.ts";

function SyncTargetsActions({
	entitlement,
}: {
	entitlement: "active" | "inactive";
}) {
	const {
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
	} = useSyncTargetsActions(entitlement);

	return (
		<SyncTargetsPanel
			accounts={accounts}
			connectPendingProvider={connectPendingProvider}
			disconnectPendingProvider={disconnectPendingProvider}
			entitlement={entitlement}
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

export { SyncTargetsActions };
