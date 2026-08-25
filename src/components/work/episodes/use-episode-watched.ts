import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { orpc } from "@/orpc/client";
import type { WorkView } from "@/orpc/schema";

import { applyDerivedTracking, applyEpisodeWatched } from "./optimistic";

interface WatchedContext {
	previous: WorkView | undefined;
}

interface EpisodeToggle {
	isPending: boolean;
	toggle: (instalmentLocator: string, watched: boolean) => void;
}

// Per-episode watched toggle with an optimistic cache patch. `work.get` is the
// single read seam, so the toggle mutates its cached WorkView; the You block and
// the checkbox both read from it. The mutation returns the derived whole-series
// status, which reconciles the optimistic guess before the invalidation refetch.
function useEpisodeWatched(continuityId: string): EpisodeToggle {
	const queryClient = useQueryClient();
	const queryKey = orpc.work.get.queryKey({ input: { continuityId } });

	const mutation = useMutation(
		orpc.tracking.setEpisodeWatched.mutationOptions({
			onError: (_error, _variables, context: WatchedContext | undefined) => {
				if (context) {
					queryClient.setQueryData(queryKey, context.previous);
				}
			},
			onMutate: async (variables): Promise<WatchedContext> => {
				await queryClient.cancelQueries({ queryKey });
				const previous = queryClient.getQueryData<WorkView>(queryKey);
				if (previous) {
					queryClient.setQueryData(
						queryKey,
						applyEpisodeWatched(previous, variables.instalmentLocator, variables.watched),
					);
				}
				return { previous };
			},
			onSettled: async () => {
				await queryClient.invalidateQueries({ queryKey });
			},
			onSuccess: (result) => {
				const current = queryClient.getQueryData<WorkView>(queryKey);
				if (current) {
					queryClient.setQueryData(queryKey, applyDerivedTracking(current, result));
				}
			},
		}),
	);

	const { mutate } = mutation;
	const toggle = useCallback(
		(instalmentLocator: string, watched: boolean) => {
			mutate({ continuityId, instalmentLocator, watched });
		},
		[continuityId, mutate],
	);

	return { isPending: mutation.isPending, toggle };
}

export { useEpisodeWatched };
