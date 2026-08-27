import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { workGetInput } from "@/components/work/part-state";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import type { WatchStatus } from "@/db/schema";
import { orpc } from "@/orpc/client";
import type { RateableUnit, WorkView } from "@/orpc/schema";

import { applyRating, applyRewatch, applyStatus } from "./optimistic";

interface CacheContext {
	previous: WorkView | undefined;
}

interface WorkTracking {
	setRating: (unit: RateableUnit, score: number | undefined) => void;
	setRewatch: (count: number) => void;
	setStatus: (status: WatchStatus) => void;
}

// Whole-series tracking mutations with optimistic patches of the cached
// `work.get`. Mirrors #11's `useEpisodeWatched`: patch on mutate, roll back on
// error, refetch on settle. The server echoes the input, so no success
// reconcile is needed beyond the refetch.
function useWorkTracking(
	continuityId: string,
	order?: PresentationOrderSlug,
): WorkTracking {
	const queryClient = useQueryClient();
	const queryKey = orpc.work.get.queryKey({
		input: workGetInput(continuityId, order),
	});

	const patch = async (
		transform: (work: WorkView) => WorkView,
	): Promise<CacheContext> => {
		await queryClient.cancelQueries({ queryKey });
		const previous = queryClient.getQueryData<WorkView>(queryKey);
		if (previous) {
			queryClient.setQueryData(queryKey, transform(previous));
		}
		return { previous };
	};
	const rollback = (context: CacheContext | undefined) => {
		if (context) {
			queryClient.setQueryData(queryKey, context.previous);
		}
	};
	const settle = async () => {
		await queryClient.invalidateQueries({ queryKey });
	};

	const statusMutation = useMutation(
		orpc.tracking.setStatus.mutationOptions({
			onError: (_error, _variables, context: CacheContext | undefined) => {
				rollback(context);
			},
			onMutate: async (variables) =>
				patch((work) => applyStatus(work, variables.status)),
			onSettled: settle,
		}),
	);
	const rewatchMutation = useMutation(
		orpc.tracking.setRewatch.mutationOptions({
			onError: (_error, _variables, context: CacheContext | undefined) => {
				rollback(context);
			},
			onMutate: async (variables) =>
				patch((work) => applyRewatch(work, variables.count)),
			onSettled: settle,
		}),
	);
	const ratingMutation = useMutation(
		orpc.tracking.setRating.mutationOptions({
			onError: (_error, _variables, context: CacheContext | undefined) => {
				rollback(context);
			},
			onMutate: async (variables) =>
				patch((work) => applyRating(work, variables.unit, variables.score)),
			onSettled: settle,
		}),
	);

	const { mutate: mutateStatus } = statusMutation;
	const { mutate: mutateRewatch } = rewatchMutation;
	const { mutate: mutateRating } = ratingMutation;

	const setStatus = useCallback(
		(status: WatchStatus) => {
			mutateStatus({ continuityId, status });
		},
		[continuityId, mutateStatus],
	);
	const setRewatch = useCallback(
		(count: number) => {
			mutateRewatch({ continuityId, count });
		},
		[continuityId, mutateRewatch],
	);
	const setRating = useCallback(
		(unit: RateableUnit, score: number | undefined) => {
			mutateRating({ score, unit });
		},
		[mutateRating],
	);

	return { setRating, setRewatch, setStatus };
}

export { useWorkTracking };
