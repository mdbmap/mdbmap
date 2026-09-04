import type { QueryClient, QueryKey } from "@tanstack/react-query";

import type { EpisodeWatchedResult, WorkView } from "@/orpc/schema";

import { applyDerivedTracking } from "./optimistic";
import { progressMutationScope } from "./progress-mutation-scope";

interface ProgressVariables {
	continuityId: string;
	watched: boolean;
}

const hasOtherScopedProgress = (
	queryClient: QueryClient,
	continuityId: string,
	variables: unknown,
) =>
	queryClient.isMutating({
		predicate: (mutation) =>
			mutation.options.scope?.id === progressMutationScope(continuityId).id &&
			mutation.state.variables !== variables,
	}) > 0;

const patchCachedWork = (
	queryClient: QueryClient,
	queryKey: QueryKey,
	patch: (work: WorkView) => WorkView,
) => {
	const current = queryClient.getQueryData<WorkView>(queryKey);
	if (current) {
		queryClient.setQueryData(queryKey, patch(current));
	}
};

const progressCacheEffects = <TVariables extends ProgressVariables>(
	queryClient: QueryClient,
	queryKey: QueryKey,
	apply: (work: WorkView, variables: TVariables) => WorkView,
) => ({
	onError: (_error: unknown, variables: TVariables) => {
		patchCachedWork(queryClient, queryKey, (work) =>
			apply(work, { ...variables, watched: !variables.watched }),
		);
	},
	onMutate: async (variables: TVariables) => {
		await queryClient.cancelQueries({ queryKey });
		patchCachedWork(queryClient, queryKey, (work) => apply(work, variables));
	},
	onSettled: async (_data: unknown, _error: unknown, variables: TVariables) => {
		if (
			hasOtherScopedProgress(queryClient, variables.continuityId, variables)
		) {
			return;
		}
		await queryClient.invalidateQueries({ queryKey });
	},
	onSuccess: (result: EpisodeWatchedResult, variables: TVariables) => {
		if (
			hasOtherScopedProgress(queryClient, variables.continuityId, variables)
		) {
			return;
		}
		patchCachedWork(queryClient, queryKey, (work) =>
			applyDerivedTracking(work, result),
		);
	},
});

export { progressCacheEffects };
