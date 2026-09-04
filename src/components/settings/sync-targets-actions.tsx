import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";

import type { SyncAccountProvider } from "@/db/schema";
import type { SyncAccountPublic } from "@/lib/sync-accounts";
import { orpc } from "@/orpc/client";

import { SyncTargetsPanel } from "./sync-targets.tsx";

const EMPTY_ACCOUNTS: readonly SyncAccountPublic[] = [];
const EMPTY_TOKENS: Partial<Record<SyncAccountProvider, string>> = {};

function SyncTargetsActions({
	entitlement,
}: {
	entitlement: "active" | "inactive";
}) {
	const queryClient = useQueryClient();
	const [tokens, setTokens] =
		useState<Partial<Record<SyncAccountProvider, string>>>(EMPTY_TOKENS);
	const [message, setMessage] = useState<string | undefined>();

	const listQuery = useQuery({
		...orpc.sync.list.queryOptions(),
		enabled: entitlement === "active",
	});

	const invalidateList = useCallback(async () => {
		await queryClient.invalidateQueries({
			queryKey: orpc.sync.list.queryKey(),
		});
	}, [queryClient]);

	const connect = useMutation(
		orpc.sync.connect.mutationOptions({
			onError: (error) => {
				setMessage(error.message);
			},
			onSuccess: async () => {
				setMessage(undefined);
				await invalidateList();
			},
		}),
	);
	const disconnect = useMutation(
		orpc.sync.disconnect.mutationOptions({
			onError: (error) => {
				setMessage(error.message);
			},
			onSuccess: async () => {
				setMessage(undefined);
				await invalidateList();
			},
		}),
	);
	const syncNow = useMutation(
		orpc.sync.pushLibrary.mutationOptions({
			onError: (error) => {
				setMessage(error.message);
			},
			onSuccess: async () => {
				setMessage(undefined);
				await invalidateList();
			},
		}),
	);

	const onTokenChange = useCallback(
		(provider: SyncAccountProvider, value: string) => {
			setTokens((current) => ({ ...current, [provider]: value }));
		},
		[],
	);

	const onConnect = useCallback(
		(provider: SyncAccountProvider, accessToken: string) => {
			setTokens((current) => ({ ...current, [provider]: "" }));
			connect.mutate({
				credentials: { accessToken },
				provider,
			});
		},
		[connect],
	);

	const onDisconnect = useCallback(
		(provider: SyncAccountProvider) => {
			disconnect.mutate({ provider });
		},
		[disconnect],
	);

	const onSyncNow = useCallback(() => {
		syncNow.mutate({});
	}, [syncNow]);

	const panelMessage = message ?? listQuery.error?.message;
	const connectPendingProvider = connect.isPending
		? connect.variables?.provider
		: undefined;
	const disconnectPendingProvider = disconnect.isPending
		? disconnect.variables?.provider
		: undefined;

	return (
		<SyncTargetsPanel
			accounts={listQuery.data ?? EMPTY_ACCOUNTS}
			connectPendingProvider={connectPendingProvider}
			disconnectPendingProvider={disconnectPendingProvider}
			entitlement={entitlement}
			message={panelMessage}
			onConnect={onConnect}
			onDisconnect={onDisconnect}
			onSyncNow={onSyncNow}
			onTokenChange={onTokenChange}
			syncPending={syncNow.isPending}
			tokens={tokens}
		/>
	);
}

export { SyncTargetsActions };
