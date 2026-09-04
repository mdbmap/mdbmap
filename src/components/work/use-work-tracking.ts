import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";

import { workGetInput } from "@/components/work/part-state";
import type { PresentationOrderSlug } from "@/db/engine-schema";
import type { WatchStatus } from "@/db/schema";
import { client, orpc } from "@/orpc/client";
import type { RateableUnit, TrackingSummary, WorkView } from "@/orpc/schema";

import { applyRating, applyRewatch, applyStatus } from "./sidebar/optimistic";
import { createTrackingWriteBarrier, resultOf } from "./tracking-write-barrier";

interface CacheContext {
	previous: WorkView | undefined;
}

interface WorkTracking {
	remove: () => void;
	removing: boolean;
	setRating: (unit: RateableUnit, score: number | undefined) => void;
	setRewatch: (count: number) => void;
	setStatus: (status: WatchStatus) => void;
}

const discardedStatus = (status: WatchStatus): TrackingSummary => ({
	rewatchCount: 0,
	status,
});

const discardedRewatch = (count: number): TrackingSummary => ({
	rewatchCount: count,
	status: "watching",
});

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
	const libraryQueryKey = orpc.library.list.key();
	const [barrierId, setBarrierId] = useState(continuityId);
	const [barrier, setBarrier] = useState(createTrackingWriteBarrier);
	if (barrierId !== continuityId) {
		setBarrierId(continuityId);
		setBarrier(createTrackingWriteBarrier());
	}

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
	const compensate = useCallback(
		async () => client.tracking.remove({ continuityId }),
		[continuityId],
	);

	const statusMutation = useMutation({
		...orpc.tracking.setStatus.mutationOptions({
			onError: (_error, _variables, context: CacheContext | undefined) => {
				rollback(context);
			},
			onMutate: async (variables) =>
				patch((work) => applyStatus(work, variables.status)),
			onSettled: settle,
		}),
		mutationFn: async (variables) => {
			const outcome = await barrier.runWrite(
				async () => client.tracking.setStatus(variables),
				compensate,
			);
			return resultOf(outcome, discardedStatus(variables.status));
		},
	});
	const rewatchMutation = useMutation({
		...orpc.tracking.setRewatch.mutationOptions({
			onError: (_error, _variables, context: CacheContext | undefined) => {
				rollback(context);
			},
			onMutate: async (variables) =>
				patch((work) => applyRewatch(work, variables.count)),
			onSettled: settle,
		}),
		mutationFn: async (variables) => {
			const outcome = await barrier.runWrite(
				async () => client.tracking.setRewatch(variables),
				compensate,
			);
			return resultOf(outcome, discardedRewatch(variables.count));
		},
	});
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
	const removeMutation = useMutation({
		...orpc.tracking.remove.mutationOptions({
			onError: (_error, _variables, context: CacheContext | undefined) => {
				rollback(context);
			},
			onSuccess: async () => {
				await queryClient.invalidateQueries({ queryKey });
				await queryClient.invalidateQueries({ queryKey: libraryQueryKey });
				await navigate({ to: "/library" });
			},
		}),
		mutationFn: async (variables) =>
			barrier.runRemove(async () => client.tracking.remove(variables)),
	});

	const { mutate: mutateStatus } = statusMutation;
	const { mutate: mutateRewatch } = rewatchMutation;
	const { mutate: mutateRating } = ratingMutation;
	const { mutate: mutateRemove } = removeMutation;
	const removing = removeMutation.isPending || removeMutation.isSuccess;

	const setStatus = useCallback(
		(status: WatchStatus) => {
			if (barrier.blocked) {
				return;
			}
			mutateStatus({ continuityId, status });
		},
		[barrier, continuityId, mutateStatus],
	);
	const setRewatch = useCallback(
		(count: number) => {
			if (barrier.blocked) {
				return;
			}
			mutateRewatch({ continuityId, count });
		},
		[barrier, continuityId, mutateRewatch],
	);
	const setRating = useCallback(
		(unit: RateableUnit, score: number | undefined) => {
			mutateRating({ score, unit });
		},
		[mutateRating],
	);
	const remove = useCallback(() => {
		barrier.block();
		mutateRemove({ continuityId });
	}, [barrier, continuityId, mutateRemove]);

	return { remove, removing, setRating, setRewatch, setStatus };
}

export { useWorkTracking };
