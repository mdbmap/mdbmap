import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import { workGetInput } from "@/components/work/part-state";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import type { WatchStatus } from "@/db/schema";
import { orpc } from "@/orpc/client";
import type { RateableUnit, WorkView } from "@/orpc/schema";

import { applyRating, applyRewatch, applyStatus } from "./sidebar/optimistic";

interface CacheContext {
	previous: WorkView | undefined;
}

interface WorkTracking {
	remove: () => void;
	setRating: (unit: RateableUnit, score: number | undefined) => void;
	setRewatch: (count: number) => void;
	setStatus: (status: WatchStatus) => void;
}

// Tracking mutations (work/part/episode/film) with optimistic patches of the
// cached `work.get`. Mirrors `useEpisodeWatched`: patch on mutate, roll back on
// error, refetch on settle. The server echoes the input, so no success
// reconcile is needed beyond the refetch.
function useWorkTracking(
	continuityId: string,
	order?: PresentationOrderSlug,
): WorkTracking {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const queryKey = orpc.work.get.queryKey({
		input: workGetInput(continuityId, order),
	});
	const libraryQueryKey = orpc.library.list.queryOptions().queryKey;

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
	const removeMutation = useMutation(
		orpc.tracking.remove.mutationOptions({
			onError: (_error, _variables, context: CacheContext | undefined) => {
				rollback(context);
			},
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey });
				await queryClient.invalidateQueries({ queryKey: libraryQueryKey });
				await navigate({ to: "/library" });
			},
		}),
	);

	const { mutate: mutateStatus } = statusMutation;
	const { mutate: mutateRewatch } = rewatchMutation;
	const { mutate: mutateRating } = ratingMutation;
	const { mutate: mutateRemove } = removeMutation;

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
	const remove = useCallback(() => {
		mutateRemove({ continuityId });
	}, [continuityId, mutateRemove]);

	return { remove, setRating, setRewatch, setStatus };
}

export { useWorkTracking };
