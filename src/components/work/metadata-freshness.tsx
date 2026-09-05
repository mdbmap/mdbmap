import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useCallback } from "react";

import { workGetInput } from "@/components/work/part-state";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import { orpc } from "@/orpc/client";

const SEPARATOR = " · ";

const formattedUpdated = (iso: string): string => {
	const then = Date.parse(iso);
	if (Number.isNaN(then)) {
		return "Updated";
	}
	return `Updated ${new Intl.DateTimeFormat("en", {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(then)}`;
};

const stampOf = (lastUpdatedAt: string | undefined): string =>
	lastUpdatedAt === undefined
		? "Catalogue metadata"
		: formattedUpdated(lastUpdatedAt);

const actionOf = (pending: boolean, available: boolean): string => {
	if (pending) {
		return "Refreshing…";
	}
	if (available) {
		return "Refresh";
	}
	return "Refresh cooling down";
};

interface MetadataFreshnessProps {
	continuityId: string;
	lastUpdatedAt: string | undefined;
	order?: PresentationOrderSlug | undefined;
	proposalId?: number | undefined;
	userRefreshAvailableAt: string | undefined;
}

function MetadataFreshness({
	continuityId,
	lastUpdatedAt,
	order,
	proposalId,
	userRefreshAvailableAt,
}: MetadataFreshnessProps) {
	const queryClient = useQueryClient();
	const queryKey = orpc.work.get.queryKey({
		input: workGetInput(continuityId, { order, proposalId }),
	});
	const mutation = useMutation(
		orpc.work.refreshMetadata.mutationOptions({
			onSettled: async () => {
				await queryClient.invalidateQueries({ queryKey });
			},
		}),
	);
	const available = userRefreshAvailableAt === undefined;
	const onRefresh = useCallback(() => {
		if (!available || mutation.isPending) {
			return;
		}
		mutation.mutate({
			continuityId,
			locale: workGetInput(continuityId).locale,
		});
	}, [available, continuityId, mutation]);

	return (
		<p className="text-ink/45 mt-3 font-mono text-[11px]">
			<span>{stampOf(lastUpdatedAt)}</span>
			<span>{SEPARATOR}</span>
			<button
				aria-label="Refresh catalogue metadata"
				className="text-ink/50 hover:text-accent disabled:hover:text-ink/50 inline-flex cursor-pointer items-center gap-1 disabled:cursor-not-allowed"
				disabled={!available || mutation.isPending}
				onClick={onRefresh}
				title={
					available
						? "Request a fresh copy from TMDB or AniDB"
						: "This entry can be refreshed once every 24 hours"
				}
				type="button"
			>
				<RefreshCw aria-hidden="true" size={12} />
				{actionOf(mutation.isPending, available)}
			</button>
		</p>
	);
}

export { MetadataFreshness };
