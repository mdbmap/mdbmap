import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useCallback } from "react";

import { workGetInput } from "@/components/work/part-state";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import { orpc } from "@/orpc/client";

import { applyEpisodeWatched, applyPartWatched } from "./optimistic";
import { progressCacheEffects } from "./progress-cache";
import { progressMutationScope } from "./progress-mutation-scope";

interface EpisodeToggle {
	isPending: boolean;
	setMany: (locators: string[], watched: boolean) => void;
	toggle: (instalmentLocator: string, watched: boolean) => void;
}

const episodeWatchedOptions = (queryClient: QueryClient, queryKey: QueryKey) =>
	orpc.tracking.setEpisodeWatched.mutationOptions(
		progressCacheEffects(queryClient, queryKey, (work, variables) =>
			applyEpisodeWatched(work, variables.instalmentLocator, variables.watched),
		),
	);

const partWatchedOptions = (queryClient: QueryClient, queryKey: QueryKey) =>
	orpc.tracking.setPartWatched.mutationOptions(
		progressCacheEffects(queryClient, queryKey, (work, variables) =>
			applyPartWatched(work, variables.instalmentLocators, variables.watched),
		),
	);

function useEpisodeWatched(
	continuityId: string,
	requireAuth: (action: () => void) => void,
	order?: PresentationOrderSlug,
	proposalId?: number,
): EpisodeToggle {
	const queryClient = useQueryClient();
	const queryKey = orpc.work.get.queryKey({
		input: workGetInput(continuityId, { order, proposalId }),
	});
	const episodeMutation = useMutation({
		...episodeWatchedOptions(queryClient, queryKey),
		scope: progressMutationScope(continuityId),
	});
	const partMutation = useMutation({
		...partWatchedOptions(queryClient, queryKey),
		scope: progressMutationScope(continuityId),
	});
	const { mutate } = episodeMutation;
	const { mutate: mutateMany } = partMutation;
	const toggle = useCallback(
		(instalmentLocator: string, watched: boolean) => {
			requireAuth(() => {
				mutate({ continuityId, instalmentLocator, watched });
			});
		},
		[continuityId, mutate, requireAuth],
	);
	const setMany = useCallback(
		(instalmentLocators: string[], watched: boolean) => {
			requireAuth(() => {
				mutateMany({ continuityId, instalmentLocators, watched });
			});
		},
		[continuityId, mutateMany, requireAuth],
	);

	return {
		isPending: episodeMutation.isPending || partMutation.isPending,
		setMany,
		toggle,
	};
}

export { useEpisodeWatched };
