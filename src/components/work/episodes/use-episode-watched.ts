import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { useCallback } from "react";
import type { ReactNode } from "react";

import { workGetInput } from "@/components/work/part-state";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import { useRequireAuth } from "@/integrations/better-auth/require-auth";
import { orpc } from "@/orpc/client";
import type { EpisodeWatchedResult, WorkView } from "@/orpc/schema";

import { applyDerivedTracking, applyEpisodeWatched } from "./optimistic";

interface WatchedContext {
	previous: WorkView | undefined;
}

interface EpisodeToggle {
	authDialog: ReactNode;
	isPending: boolean;
	toggle: (instalmentLocator: string, watched: boolean) => void;
}

const watchedMutationOptions = (queryClient: QueryClient, queryKey: QueryKey) =>
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
					applyEpisodeWatched(
						previous,
						variables.instalmentLocator,
						variables.watched,
					),
				);
			}
			return { previous };
		},
		onSettled: async () => {
			await queryClient.invalidateQueries({ queryKey });
		},
		onSuccess: (result: EpisodeWatchedResult) => {
			const current = queryClient.getQueryData<WorkView>(queryKey);
			if (current) {
				queryClient.setQueryData(
					queryKey,
					applyDerivedTracking(current, result),
				);
			}
		},
	});

// Per-episode watched toggle with an optimistic cache patch. `work.get` is the
// single read seam, so the toggle mutates its cached WorkView; the You block and
// the checkbox both read from it. The mutation returns the derived whole-series
// status, which reconciles the optimistic guess before the invalidation refetch.
function useEpisodeWatched(
	continuityId: string,
	order?: PresentationOrderSlug,
): EpisodeToggle {
	const queryClient = useQueryClient();
	const { authDialog, requireAuth } = useRequireAuth();
	const queryKey = orpc.work.get.queryKey({
		input: workGetInput(continuityId, order),
	});
	const mutation = useMutation(watchedMutationOptions(queryClient, queryKey));
	const { mutate } = mutation;
	const toggle = useCallback(
		(instalmentLocator: string, watched: boolean) => {
			requireAuth(() => {
				mutate({ continuityId, instalmentLocator, watched });
			});
		},
		[continuityId, mutate, requireAuth],
	);

	return { authDialog, isPending: mutation.isPending, toggle };
}

export { useEpisodeWatched };
